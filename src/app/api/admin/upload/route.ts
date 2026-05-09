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
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAdminUser } from '@/lib/admin-auth';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { logger } from '@/lib/env';

const S3_BUCKET = process.env.S3_BUCKET_NAME || '';
const REGION = process.env.AWS_REGION || 'ap-northeast-1';

/** アップロードサイズ上限: 10MB（Base64 前の元サイズ） */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

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

export async function POST(request: NextRequest) {
  const adminUser = await getAdminUser();
  if (!adminUser.isAuthenticated) {
    return NextResponse.json(
      { status: 'error', message: '管理者権限がありません。' },
      { status: 403 }
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

  const { filename, contentType, dataBase64 } = payload;
  if (!filename || !contentType || !dataBase64) {
    return NextResponse.json(
      { status: 'error', message: 'filename / contentType / dataBase64 が必要です。' },
      { status: 400 }
    );
  }

  // セキュリティチェック: 画像ファイルのみ許可
  if (!contentType.startsWith('image/')) {
    return NextResponse.json(
      { status: 'error', message: '画像ファイルのみアップロード可能です。' },
      { status: 400 }
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

  try {
    const timestamp = toYYYYMMDDHHMMSS(new Date());
    const sanitizedFileName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `media/articles/${adminUser.sub || 'admin'}/${timestamp}-${sanitizedFileName}`;

    await getS3Client().send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }));

    // 公開 URL は常に相対パスを返す。
    // why: 管理画面のオリジンを統一し、ブラウザの CORP 判定で画像が
    //      ブロックされるケースを避ける。
    const publicUrl = `/${key}`;

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
