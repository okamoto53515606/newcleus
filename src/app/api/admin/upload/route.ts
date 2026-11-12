/**
 * メディアアップロード API
 *
 * POST /api/admin/upload
 *
 * クライアントから JSON で Base64 化したファイルを受け取り、S3 にアップロードします。
 *
 * 【なぜ multipart/form-data ではなく JSON(Base64) なのか】
 * CloudFront OAC + Lambda Function URL 経由では、body の SHA256 を
 * x-amz-content-sha256 ヘッダに正しく載せる必要がある（AWS 公式仕様）。
 * FormData はブラウザが boundary 付き multipart を内部生成するため、
 * クライアント側で送信直前の厳密なバイト列ハッシュを事前計算できず、
 * "UNSIGNED-PAYLOAD" を送ると Lambda が拒否する。
 * JSON 文字列なら送信バイト列が確定しハッシュが一致するため、
 * Base64 エンコードで JSON に載せてこの制約を回避する。
 *
 * 【認可（認証だけで終わらせない）】
 * why: 他の管理 API は role / canAccessSite() まで検証しているのに、ここだけ
 *      「ログイン済みなら誰でも可」だと、custom:role 未設定の Cognito ユーザーや
 *      siteadmin が担当外サイトのメディア名前空間へ書き込める。S3 の /media/* は
 *      公開配信されるため、書き込み権限の範囲はコンテンツ公開権限と一致して
 *      いなければならない。siteadmin は siteId 必須＋siteIds 照合、admin は
 *      任意のサイト（siteId 省略時は従来の共通プレフィックス）とする。
 *
 * 【画像形式の検証（許可リスト＋マジックバイト）】
 * why: 申告された contentType をそのまま S3 に保存すると、image/svg+xml や
 *      画像を装った HTML/ポリグロットを配信できてしまう。/media/* は公開サイトと
 *      同一 CloudFront ドメインのため、SVG を直接開くとスクリプトがサイト origin で
 *      実行される（管理者資格が要る stored XSS）。そこで
 *      (1) Content-Type を許可リストで限定し、(2) 実データのマジックバイトで
 *      判定した型と一致することを要求し、(3) S3 に保存する Content-Type は
 *      クライアント申告値ではなくサーバー判定値にする。
 *      nosniff は付与済みだが、SVG は「正しい Content-Type で配信される」ため
 *      nosniff では防げない点に注意。
 *
 * 【サイズ上限をパース前に判定する】
 * why: `await request.json()` は本文全体をメモリに載せる。Base64 は元サイズの
 *      約 4/3 に膨れるため、デコード後にサイズ判定すると巨大ボディでメモリを
 *      消費させられる。Content-Length と Base64 文字列長で、パース前に弾く。
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAdminUser } from '@/lib/admin-auth';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getDocClient } from '@/lib/dynamodb';
// why: S3 アップロードの成功/失敗を CloudWatch Logs に残すための共通ロガー。
//      console 直接呼び出しを禁止しプロジェクト全体でログ書式を統一している。
//      注意: この import を落とすと ReferenceError でアップロード API が実質壊れる
//      （ignoreBuildErrors のためビルドは通ってしまう）。検証済み。
import { logger } from '@/lib/env';

const S3_BUCKET = process.env.S3_BUCKET_NAME || '';
const REGION = process.env.AWS_REGION || 'ap-northeast-1';

/** アップロードサイズ上限: 10MB（Base64 前の元サイズ） */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * リクエスト本文の上限（Base64 文字列長 / Content-Length 用）
 *
 * why: Base64 は元サイズの 4/3 に膨れる。JSON のキーやエスケープ分の余裕を
 *      少し足しておく（この値を超える本文はパースせず 413 で返す）。
 */
const MAX_REQUEST_BODY_BYTES = Math.ceil((MAX_FILE_SIZE * 4) / 3) + 64 * 1024;

/**
 * 許可する画像形式
 *
 * why: SVG は「画像」だがスクリプトを内包できるため除外する。TinyMCE と
 *      記事フィールドの用途では png/jpeg/gif/webp/avif で足りる。
 */
const ALLOWED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
] as const;

type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

let _s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!_s3Client) {
    _s3Client = new S3Client({ region: REGION });
  }
  return _s3Client;
}

interface UploadPayload {
  filename?: string;
  contentType?: string;
  dataBase64?: string;
  /** アップロード先のサイト ID（siteadmin は必須） */
  siteId?: string;
}

function toYYYYMMDDHHMMSS(date: Date): string {
  const y = String(date.getUTCFullYear());
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${y}${m}${d}${hh}${mm}${ss}`;
}

/**
 * サイトへのアクセス権を判定する
 *
 * why: `src/app/api/admin/sites/[siteId]/**` と同じ判定を共有する。ロールが
 *      admin/siteadmin 以外（custom:role 未設定など）は明示的に false。
 */
function canAccessSite(user: { role?: string; siteIds?: string[] }, siteId: string): boolean {
  if (user.role === 'admin') return true;
  if (user.role === 'siteadmin') return user.siteIds?.includes(siteId) ?? false;
  return false;
}

/**
 * 実データのマジックバイトから画像形式を判定する
 *
 * why: Content-Type はクライアントが自由に申告できるため、申告値だけを信じると
 *      HTML/SVG を画像として配信できてしまう。実データの先頭バイトで判定し、
 *      申告値と一致することを要求する（不一致は 400）。
 */
function detectImageType(buffer: Buffer): AllowedImageType | null {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  // JPEG: FF D8 FF
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  // GIF: "GIF87a" / "GIF89a"
  if (buffer.length >= 6) {
    const head = buffer.subarray(0, 6).toString('ascii');
    if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
  }
  // WebP: "RIFF" <4byte size> "WEBP"
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  // AVIF: <4byte size> "ftyp" "avif" / "avis"
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString('ascii');
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
  }
  return null;
}

/**
 * 申告された Content-Type を正規化する
 *
 * why: `image/jpg` は IANA 未登録だが実際に送られてくるため jpeg に寄せる。
 *      `; charset=` 等のパラメータも落とす。
 */
function normalizeContentType(value: string): string {
  const base = value.split(';')[0].trim().toLowerCase();
  return base === 'image/jpg' ? 'image/jpeg' : base;
}

function isAllowedImageType(value: string): value is AllowedImageType {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(value);
}

export async function POST(request: NextRequest) {
  // 1) 認証: Cognito の ID トークン検証。未認証は 401。
  const adminUser = await getAdminUser();
  if (!adminUser) {
    return NextResponse.json(
      { status: 'error', message: '認証が必要です。' },
      { status: 401 }
    );
  }

  // 2) 認可: admin / siteadmin 以外（custom:role 未設定など）は 403。
  if (adminUser.role !== 'admin' && adminUser.role !== 'siteadmin') {
    return NextResponse.json(
      { status: 'error', message: 'この操作を行う権限がありません。' },
      { status: 403 }
    );
  }

  // 3) サイズの事前チェック（JSON パース前）。Content-Length が無い場合は
  //    パース後に Base64 文字列長でも判定する。
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
    return NextResponse.json(
      { status: 'error', message: `ファイルサイズは 1 〜 ${MAX_FILE_SIZE / 1024 / 1024}MB にしてください。` },
      { status: 413 }
    );
  }

  let payload: UploadPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { status: 'error', message: 'リクエストが不正です。JSON を送信してください。' },
      { status: 400 }
    );
  }

  // why: `null` や配列を送られると分割代入で TypeError（500）になる。
  //      400 として返し、エラーログを汚さない。
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return NextResponse.json(
      { status: 'error', message: 'リクエストが不正です。オブジェクトを送信してください。' },
      { status: 400 }
    );
  }

  const { filename, contentType, dataBase64 } = payload;
  if (!filename || !contentType || !dataBase64) {
    return NextResponse.json(
      { status: 'error', message: 'filename / contentType / dataBase64 が必要です。' },
      { status: 400 }
    );
  }

  // 4) サイトスコープの検証
  const siteId = typeof payload.siteId === 'string' ? payload.siteId.trim() : '';
  if (siteId && !/^[A-Za-z0-9_-]{1,64}$/.test(siteId)) {
    return NextResponse.json(
      { status: 'error', message: 'siteId の形式が不正です。' },
      { status: 400 }
    );
  }
  if (adminUser.role === 'siteadmin') {
    // why: siteadmin は担当サイトの外にメディアを置けない。省略を許すと
    //      サイト非依存の名前空間へ書けてしまい、認可の意味が無くなる。
    if (!siteId) {
      return NextResponse.json(
        { status: 'error', message: 'siteId が必要です。' },
        { status: 400 }
      );
    }
    if (!canAccessSite(adminUser, siteId)) {
      return NextResponse.json(
        { status: 'error', message: 'このサイトへのアクセス権がありません。' },
        { status: 403 }
      );
    }
  }

  // 5) 形式の検証（許可リスト）
  const declaredType = normalizeContentType(contentType);
  if (!isAllowedImageType(declaredType)) {
    return NextResponse.json(
      {
        status: 'error',
        message: '対応していない画像形式です（png / jpeg / gif / webp / avif のみ）。',
      },
      { status: 400 }
    );
  }

  // 6) Base64 文字列長でも上限を判定（Content-Length が無い/嘘の場合の保険）
  if (dataBase64.length > MAX_REQUEST_BODY_BYTES) {
    return NextResponse.json(
      { status: 'error', message: `ファイルサイズは 1 〜 ${MAX_FILE_SIZE / 1024 / 1024}MB にしてください。` },
      { status: 413 }
    );
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(dataBase64, 'base64');
  } catch {
    return NextResponse.json(
      { status: 'error', message: 'Base64 データの解析に失敗しました。' },
      { status: 400 }
    );
  }

  // サイズチェック（デコード後の実バイト数）
  if (buffer.length === 0 || buffer.length > MAX_FILE_SIZE) {
    return NextResponse.json(
      { status: 'error', message: `ファイルサイズは 1 〜 ${MAX_FILE_SIZE / 1024 / 1024}MB にしてください。` },
      { status: 400 }
    );
  }

  // 7) 実データとの一致検証。ここで落ちるものは画像ではない。
  const detectedType = detectImageType(buffer);
  if (!detectedType) {
    return NextResponse.json(
      { status: 'error', message: '画像データを判別できませんでした。' },
      { status: 400 }
    );
  }
  if (detectedType !== declaredType) {
    logger.info(
      `[Upload] Content-Type と実データの不一致: declared=${declaredType} detected=${detectedType}`
    );
    return NextResponse.json(
      { status: 'error', message: '申告された Content-Type と画像データが一致しません。' },
      { status: 400 }
    );
  }

  try {
    const timestamp = toYYYYMMDDHHMMSS(new Date());
    const sanitizedFileName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    // why: サイト単位で名前空間を分ける。siteadmin が他サイトのメディアを
    //      上書き・推測できないようにするため（siteId 省略は admin のみ許可）。
    const prefix = siteId ? `media/sites/${siteId}/articles` : 'media/articles';
    const key = `${prefix}/${adminUser.sub || 'admin'}/${timestamp}-${sanitizedFileName}`;

    await getS3Client().send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: buffer,
      // why: クライアント申告値ではなく、マジックバイトから判定した型を保存する
      //      （申告値を信じると Content-Type 偽装が成立する）。
      ContentType: detectedType,
      CacheControl: 'public, max-age=31536000, immutable',
    }));

    // 公開 URL: 本番は CloudFront 絶対 URL を返す。
    // why: embed.js 経由で外部サイトに埋め込まれたとき、相対 URL では
    //      画像が埋め込み先ドメインで解決されてリンク切れになる。
    //      CloudFront 絶対 URL にすることで埋め込み先ドメインに依存しない。
    //      開発環境では CLOUDFRONT_DOMAIN を無視して相対パスを返す（従来通り）。
    const cfDomain =
      process.env.NODE_ENV === 'production' ? process.env.CLOUDFRONT_DOMAIN : null;
    const publicUrl = cfDomain ? `https://${cfDomain}/${key}` : `/${key}`;

    logger.info(`[Upload] S3 アップロード完了: ${key} (${buffer.length} bytes)`);

    return NextResponse.json({
      status: 'success',
      publicUrl,
      key,
    });
  } catch (error) {
    logger.error('[Upload] S3 アップロードエラー:', error);
    return NextResponse.json(
      { status: 'error', message: 'ファイルのアップロードに失敗しました。' },
      { status: 500 }
    );
  }
}
