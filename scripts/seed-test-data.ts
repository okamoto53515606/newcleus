#!/usr/bin/env tsx
/**
 * テストデータ投入スクリプト
 *
 * why: デモ・テスト用に本物っぽいデータを一括投入する。
 *      picsum.photos の無料フリー画像を fetch でDLして S3 にアップ後、
 *      DynamoDB に記事レコードを挿入する。
 *
 * Usage:
 *   npx tsx scripts/seed-test-data.ts             # 投入実行
 *   npx tsx scripts/seed-test-data.ts --dry-run   # DB/S3 書込なし（確認用）
 *   npx tsx scripts/seed-test-data.ts --delete    # 投入済みデータを削除（再実行前のクリア）
 *
 * 前提:
 *   - .env に AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / S3_BUCKET_NAME が設定済み
 *   - 対象サイト・CTが DynamoDB に存在すること
 */

import 'dotenv/config';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomBytes } from 'crypto';

// ─── 定数 ─────────────────────────────────────────────────────────────────────
const SITE_ID       = '394d74824fe2cafd41de';
const NEWS_CT_ID    = '14a03a56c6de2755be9a';
const GALLERY_CT_ID = 'f682d39af9c98fbb6acb';
const CF_DOMAIN     = 'd1sax4j5hw821p.cloudfront.net';
const S3_BUCKET     = process.env.S3_BUCKET_NAME ?? '';
const TABLE_PREFIX  = process.env.TABLE_PREFIX ?? 'newcleus-';
// seed スクリプトで投入したレコードを --delete で識別するための authorId マーカー
const AUTHOR_ID     = 'seed-script';
const DRY_RUN       = process.argv.includes('--dry-run');
const DO_DELETE     = process.argv.includes('--delete');

const ITEMS_TABLE   = `${TABLE_PREFIX}items`;
const GSI_CT        = 'items-by-site-content-type';

// ─── ユーティリティ ────────────────────────────────────────────────────────────
function genId(): string {
  return randomBytes(10).toString('hex');
}

/**
 * 過去 180 日間に均等分散した日付を生成
 * why: 単調な createdAt だと管理画面・公開APIのソートで不自然に見える
 */
function spreadDate(index: number, total: number): string {
  const now = Date.now();
  const sixMonthsAgo = now - 180 * 24 * 60 * 60 * 1000;
  const step = (now - sixMonthsAgo) / total;
  return new Date(sixMonthsAgo + step * (total - 1 - index)).toISOString();
}

// ─── AWS クライアント ──────────────────────────────────────────────────────────
const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION ?? 'ap-northeast-1' }),
  { marshallOptions: { removeUndefinedValues: true } },
);

const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'ap-northeast-1' });

// ─── 画像DL → S3アップロード ──────────────────────────────────────────────────
async function downloadImage(seed: string, width: number, height: number): Promise<Buffer> {
  const url = `https://picsum.photos/seed/${seed}/${width}/${height}`;
  process.stdout.write(`  ⬇  ${url} ... `);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  process.stdout.write(`${(buf.length / 1024).toFixed(0)} KB\n`);
  return buf;
}

async function uploadS3(key: string, buf: Buffer): Promise<string> {
  const cfUrl = `https://${CF_DOMAIN}/${key}`;
  if (DRY_RUN) {
    console.log(`  [dry-run] S3 PUT s3://${S3_BUCKET}/${key}`);
    return cfUrl;
  }
  await s3.send(
    new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, Body: buf, ContentType: 'image/jpeg' }),
  );
  return cfUrl;
}

async function putItem(item: Record<string, unknown>): Promise<void> {
  if (DRY_RUN) {
    console.log(`  [dry-run] DynamoDB PUT: ${item.itemId}`);
    return;
  }
  await ddb.send(new PutCommand({ TableName: ITEMS_TABLE, Item: item }));
}

// ─── お知らせデータ定義（20件）────────────────────────────────────────────────
const NEWS_ITEMS: {
  title: string;
  seed: string;
  bodyP1: string;
  bodyP2: string;
}[] = [
  {
    title: '年末年始の休業日のご案内',
    seed: 'winter1',
    bodyP1: '平素は格別のご高配を賜り、厚く御礼申し上げます。誠に勝手ながら、12月29日（日）〜1月3日（金）を年末年始休業とさせていただきます。',
    bodyP2: '新年は1月6日（月）より通常通り営業いたします。休業期間中にいただいたお問い合わせにつきましては、1月6日以降に順次ご対応させていただきます。何卒ご了承くださいますようお願い申し上げます。',
  },
  {
    title: '新スタッフ紹介のお知らせ',
    seed: 'team2',
    bodyP1: 'このたび、心強い新しいスタッフが加わりました。豊富な経験とフレッシュな感性を持つメンバーとともに、さらに質の高いサービスを提供してまいります。',
    bodyP2: 'どうぞよろしくお願いいたします。新スタッフのプロフィールは「スタッフ紹介」ページにてご確認いただけます。',
  },
  {
    title: '夏季休業のご案内',
    seed: 'summer3',
    bodyP1: '誠に勝手ながら、8月13日（火）〜16日（金）を夏季休業とさせていただきます。お急ぎの場合はメールにてお問い合わせください。',
    bodyP2: '8月19日（月）より通常通りの営業を再開いたします。ご不便をおかけいたしますが、何卒ご了承のほどよろしくお願い申し上げます。',
  },
  {
    title: 'ホームページをリニューアルしました',
    seed: 'web2',
    bodyP1: 'この度、皆様にご不便をおかけしていたホームページを全面リニューアルいたしました。スマートフォンでも見やすいデザインを採用し、お知らせ情報もリアルタイムで更新できるようになりました。',
    bodyP2: '引き続きご意見・ご要望がございましたら、お問い合わせフォームよりお気軽にお知らせください。今後ともよろしくお願いいたします。',
  },
  {
    title: 'ゴールデンウィーク期間中の営業について',
    seed: 'spring2',
    bodyP1: 'GW期間中（4月29日〜5月6日）の営業スケジュールをお知らせします。4月30日・5月1日・5月2日は通常営業、4月29日・5月3日〜6日は休業とさせていただきます。',
    bodyP2: 'ご来訪の際は事前にご確認いただけますと幸いです。5月7日（火）より通常営業に戻ります。皆様のご来訪をお待ちしております。',
  },
  {
    title: 'オンライン予約システム開始のお知らせ',
    seed: 'tech2',
    bodyP1: '長らくお待たせいたしました。この度、24時間いつでもご利用いただけるオンライン予約システムの運用を開始いたします。',
    bodyP2: 'ご予約はトップページの「予約する」ボタンからお進みください。初回ご利用の際はユーザー登録が必要です。操作方法がご不明な場合はスタッフまでお気軽にお声がけください。',
  },
  {
    title: 'システムメンテナンスのお知らせ',
    seed: 'server2',
    bodyP1: '11月20日（水）の深夜0時〜2時の間、システムメンテナンスを実施いたします。この時間帯はオンライン予約・マイページなどのオンラインサービスがご利用いただけません。',
    bodyP2: 'ご迷惑をおかけして誠に申し訳ございません。メンテナンス終了後は順次サービスを再開いたします。お急ぎの場合はお電話にてお問い合わせください。',
  },
  {
    title: '移転のお知らせ',
    seed: 'building2',
    bodyP1: 'このたび、皆様により便利にご利用いただけるよう、駅により近い立地へと移転いたしました。最寄り駅から徒歩3分とアクセスが大幅に改善されました。',
    bodyP2: '新住所：○○市○○区○○町1-2-3 ○○ビル2F（旧住所より南へ徒歩5分）。駐車場も完備しておりますので、お車でのご来訪も引き続きご利用いただけます。',
  },
  {
    title: '感染症対策の取り組みについて',
    seed: 'health2',
    bodyP1: '当施設では皆様が安心してご利用いただけるよう、入口での検温・手指消毒の実施、定期的な換気と消毒、スタッフのマスク着用などの感染予防対策を継続しております。',
    bodyP2: 'ご来訪の際はマスクのご着用にご協力をお願いいたします。発熱や体調不良の場合は、ご来訪をご遠慮いただきますようお願い申し上げます。',
  },
  {
    title: 'スタッフ研修のため臨時休業のご案内',
    seed: 'study2',
    bodyP1: '10月15日（火）はスタッフ全員参加の研修会のため、終日休業とさせていただきます。皆様により良いサービスをご提供するための大切な機会ですので、ご了承くださいますようお願い申し上げます。',
    bodyP2: '翌16日（水）より通常営業を再開いたします。ご不便をおかけして大変申し訳ございません。',
  },
  {
    title: 'アクセス・駐車場情報をリニューアルしました',
    seed: 'map2',
    bodyP1: '初めてご来訪の方からのご要望を多くいただいておりましたため、アクセス・駐車場情報ページをリニューアルいたしました。地図・写真付きで分かりやすくご案内しています。',
    bodyP2: 'バス停「○○前」から徒歩2分、電車は○○駅西口から徒歩5分です。駐車場は施設裏手に10台分ご用意しております。満車の際はお近くのコインパーキングをご利用ください。',
  },
  {
    title: 'お問い合わせ受付時間の変更について',
    seed: 'phone2',
    bodyP1: '4月より電話受付時間を 9:00〜17:00（土日祝除く）に変更させていただきます。メールでのお問い合わせは24時間受け付けておりますのでご利用ください。',
    bodyP2: '変更後の電話番号・メールアドレスは「お問い合わせ」ページをご参照ください。よりスムーズにご対応できるよう努めてまいりますので、今後ともよろしくお願いいたします。',
  },
  {
    title: '会員向け特別サービスキャンペーンのご案内',
    seed: 'campaign2',
    bodyP1: '日頃のご愛顧に感謝を込めて、会員登録済みのお客様を対象に今月末まで特別価格でサービスをご利用いただけるキャンペーンを実施中です。',
    bodyP2: '対象サービスや詳細はキャンペーンページをご確認ください。この機会にぜひご活用いただければ幸いです。ご不明な点はスタッフまでお気軽にお申し付けください。',
  },
  {
    title: 'セキュリティ・個人情報保護強化のお知らせ',
    seed: 'security2',
    bodyP1: 'お客様の大切な個人情報を守るため、このたびシステムのセキュリティを強化いたしました。通信の暗号化強化・不正アクセス対策の見直しを実施しております。',
    bodyP2: '引き続き安心してご利用いただけます。プライバシーポリシーも改訂いたしましたので、ページ下部のリンクよりご確認ください。',
  },
  {
    title: '施設内 Wi-Fi サービス開始のお知らせ',
    seed: 'wifi2',
    bodyP1: 'お待たせいたしました！施設内に無料 Wi-Fi を設置いたしました。お待ちの時間や作業中などにぜひご活用ください。',
    bodyP2: 'ネットワーク名（SSID）・接続パスワードは受付にてご案内しております。通信内容の盗聴リスクを避けるため、インターネットバンキングなどの重要な操作はご自身のモバイル回線をご利用ください。',
  },
  {
    title: '春の感謝祭イベント開催のご案内',
    seed: 'event2',
    bodyP1: '3月最終土曜日に「春の感謝祭」を開催いたします。日頃のご愛顧に感謝を込めて、特別展示・体験コーナー・抽選会などをご用意しています。ご家族でお気軽にお越しください。',
    bodyP2: '開催時間：10:00〜16:00、参加費無料。事前予約不要でどなたでもご参加いただけます。雨天の場合は施設内にて開催いたします。たくさんのご来場をお待ちしております！',
  },
  {
    title: '代表からのご挨拶・新年度方針',
    seed: 'message2',
    bodyP1: '新年度を迎え、代表よりご挨拶申し上げます。昨年度も多くの皆様にご利用いただき、誠にありがとうございました。スタッフ一同、皆様に感謝申し上げます。',
    bodyP2: '本年度は「もっと身近に、もっと便利に」をテーマに、サービスの充実とデジタル対応強化に取り組んでまいります。引き続きご支援・ご指導のほど、よろしくお願い申し上げます。',
  },
  {
    title: '駐車場の増設・整備完了のお知らせ',
    seed: 'parking2',
    bodyP1: '以前より多くのお客様からご要望をいただいておりました駐車場を増設・整備いたしました。従来の8台から15台に拡張し、バリアフリー対応スペースも2台新設しております。',
    bodyP2: '工事中はご不便をおかけして誠に申し訳ございませんでした。今後はより快適にお車でのご来訪をお楽しみいただけます。どうぞお気軽にお越しください。',
  },
  {
    title: '旬の食材を使った新メニュー登場',
    seed: 'food2',
    bodyP1: '地域の農家と連携し、旬の食材をふんだんに使った新メニューが登場しました。季節ごとに内容が変わりますので、何度お越しいただいても新しい発見があります。',
    bodyP2: '現在は春野菜を使ったメニューを提供中です。食材の産地・こだわりポイントはメニュー表に掲載しています。ぜひ一度お試しください。',
  },
  {
    title: '地域清掃活動への参加報告',
    seed: 'community2',
    bodyP1: '先日、地域自治会が主催する清掃活動にスタッフ5名で参加いたしました。近隣の公園・歩道のゴミ拾いや落ち葉清掃を行い、地域の皆様と一緒に気持ちよく汗をかきました。',
    bodyP2: '今後も地域社会への貢献活動を継続し、地域の皆様に愛される施設づくりに努めてまいります。このような取り組みを通じて、地域のつながりを大切にしていきたいと思います。',
  },
];

// ─── フォトギャラリーデータ定義（20件）────────────────────────────────────────
const GALLERY_ITEMS: {
  title: string;
  caption: string;
  date: string;
  seed: string;
  w: number;
  h: number;
}[] = [
  { title: '春の桜', caption: '満開の桜が青空に映える季節になりました。今年も美しく咲いてくれました。', date: '2025-04-05', seed: 'cherry2', w: 1200, h: 800 },
  { title: '初夏の新緑', caption: '生き生きとした緑が眩しい初夏の一枚。自然の生命力を感じます。', date: '2025-05-20', seed: 'green2', w: 1200, h: 800 },
  { title: '夏の海辺', caption: '澄んだ海と白い砂浜。忘れられない夏の記憶です。', date: '2025-07-15', seed: 'sea2', w: 1200, h: 800 },
  { title: '夕暮れの丘', caption: '夕陽が丘を黄金色に染める穏やかな夕方の風景。', date: '2025-07-28', seed: 'sunset2', w: 1200, h: 800 },
  { title: '秋の紅葉', caption: '赤や黄色に染まった山の秋景色。紅葉の見頃に合わせて撮影しました。', date: '2025-10-20', seed: 'autumn2', w: 1200, h: 800 },
  { title: '冬の雪景色', caption: '真っ白な雪に包まれた静かな冬の朝。音のない世界が心を落ち着かせます。', date: '2025-12-15', seed: 'snow2', w: 1200, h: 800 },
  { title: '都市の夜景', caption: '夜の街に煌めく光が幻想的な空間を演出します。高台から撮影。', date: '2026-01-10', seed: 'city2', w: 1200, h: 800 },
  { title: '山岳の朝霧', caption: '幻想的な朝霧が山間に漂う清々しい朝。早起きした甲斐がありました。', date: '2026-02-03', seed: 'mountain2', w: 1200, h: 800 },
  { title: 'お気に入りのカフェ', caption: 'ゆったりとした時間が流れるお気に入りの場所。コーヒーが絶品です。', date: '2026-02-20', seed: 'cafe2', w: 1200, h: 800 },
  { title: '路地裏の風景', caption: '何気ない日常の美しさを発見。路地裏にこそ街の味わいがあります。', date: '2026-03-05', seed: 'street2', w: 1200, h: 800 },
  { title: '花畑の広がり', caption: 'カラフルな花々が一面に広がる幸せな風景。思わず足を止めてしまいました。', date: '2026-03-22', seed: 'flower2', w: 1200, h: 800 },
  { title: '川沿いの散歩道', caption: 'のどかな川沿いを散歩する心地よい午後。桜の木が続く道です。', date: '2026-04-01', seed: 'river2', w: 1200, h: 800 },
  { title: '夜のカフェ通り', caption: 'ネオンサインと街灯が彩る夜のカフェ通り。賑やかで温かい雰囲気。', date: '2026-04-10', seed: 'nightcafe2', w: 1200, h: 800 },
  { title: '旅の出発点', caption: '旅の始まりと終わりの交差点。新しい場所への期待が膨らみます。', date: '2026-04-18', seed: 'airport2', w: 1200, h: 800 },
  { title: '石畳の路地', caption: '歴史を感じさせる石畳の路地。時が止まったような静けさが魅力です。', date: '2026-04-25', seed: 'cobble2', w: 1200, h: 800 },
  { title: '森の木漏れ日', caption: '静かな森の中、木漏れ日が差し込む神秘的な一瞬を切り取りました。', date: '2026-05-01', seed: 'forest2', w: 1200, h: 800 },
  { title: '青空と白い雲', caption: 'どこまでも続く青空とふかふかの白い雲。見ているだけで気持ちが晴れます。', date: '2026-05-05', seed: 'sky2', w: 1200, h: 800 },
  { title: '港の朝', caption: '漁船が並ぶ港の朝。静かで力強い日常がそこにありました。', date: '2026-05-08', seed: 'port2', w: 1200, h: 800 },
  { title: '秋の公園', caption: '落ち葉が舞う秋の公園。ベンチに座りたくなる穏やかな午後です。', date: '2025-11-10', seed: 'park2', w: 1200, h: 800 },
  { title: '雨上がりの街', caption: '雨上がりの街路樹、濡れた石畳が光を反射して幻想的な雰囲気に。', date: '2026-05-09', seed: 'rain2', w: 1200, h: 800 },
];

// ─── 削除処理 ─────────────────────────────────────────────────────────────────
async function deleteSeededItems(ctId: string, label: string): Promise<void> {
  console.log(`\n🗑  ${label} の seed データを削除中...`);
  const siteCtKey = `${SITE_ID}#${ctId}`;
  let lastKey: Record<string, unknown> | undefined;
  let count = 0;

  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: ITEMS_TABLE,
        IndexName: GSI_CT,
        KeyConditionExpression: 'siteContentTypeKey = :sck',
        FilterExpression: 'authorId = :aid',
        ExpressionAttributeValues: { ':sck': siteCtKey, ':aid': AUTHOR_ID },
        ExclusiveStartKey: lastKey,
      }),
    );

    const items = res.Items ?? [];
    for (const item of items) {
      if (DRY_RUN) {
        console.log(`  [dry-run] DELETE ${item.itemId}`);
      } else {
        await ddb.send(
          new DeleteCommand({
            TableName: ITEMS_TABLE,
            Key: { siteId: item.siteId, itemId: item.itemId },
          }),
        );
        console.log(`  ✅ deleted ${item.itemId}`);
      }
      count++;
    }

    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  console.log(`  合計 ${count} 件削除`);
}

// ─── お知らせ投入 ──────────────────────────────────────────────────────────────
async function seedNews(): Promise<void> {
  console.log('\n📰 お知らせ（20件）を投入中...');

  for (let i = 0; i < NEWS_ITEMS.length; i++) {
    const d = NEWS_ITEMS[i];
    const itemId    = genId();
    const createdAt = spreadDate(i, NEWS_ITEMS.length);
    const ts        = createdAt.replace(/\D/g, '').slice(0, 14);

    console.log(`\n[${i + 1}/${NEWS_ITEMS.length}] ${d.title}`);

    // 画像DL → S3アップロード
    // why: CloudFront は /media/* を S3 origin にルーティングする。
    //      media/ プレフィックスがないとデフォルト behavior（Lambda）に飛んで 404 になる。
    const imgKey = `media/sites/${SITE_ID}/items/${itemId}/${ts}-news.jpg`;
    const imgBuf = await downloadImage(d.seed, 800, 500);
    const imgUrl = await uploadS3(imgKey, imgBuf);

    const body = [
      `<p>${d.bodyP1}</p>`,
      `<figure style="margin:1.5em 0">`,
      `  <img src="${imgUrl}" alt="${d.title}" style="max-width:100%;height:auto;border-radius:6px;display:block">`,
      `</figure>`,
      `<p>${d.bodyP2}</p>`,
    ].join('\n');

    await putItem({
      siteId:              SITE_ID,
      itemId,
      title:               d.title,
      body,
      contentTypeId:       NEWS_CT_ID,
      status:              'published',
      authorId:            AUTHOR_ID,
      siteContentTypeKey:  `${SITE_ID}#${NEWS_CT_ID}`,
      fields:              {},
      createdAt,
      updatedAt:           createdAt,
    });

    console.log(`  ✅ ${itemId}`);
  }
}

// ─── フォトギャラリー投入 ──────────────────────────────────────────────────────
async function seedGallery(): Promise<void> {
  console.log('\n🖼  フォトギャラリー（20件）を投入中...');

  for (let i = 0; i < GALLERY_ITEMS.length; i++) {
    const d = GALLERY_ITEMS[i];
    const itemId    = genId();
    const createdAt = spreadDate(i, GALLERY_ITEMS.length);
    const ts        = createdAt.replace(/\D/g, '').slice(0, 14);

    console.log(`\n[${i + 1}/${GALLERY_ITEMS.length}] ${d.title}`);

    // 画像DL → S3アップロード
    // why: CloudFront /media/* → S3 behavior にヒットさせるために media/ プレフィックスが必要。
    const imgKey = `media/sites/${SITE_ID}/fields/${itemId}/file0-${ts}-photo.jpg`;
    const imgBuf = await downloadImage(d.seed, d.w, d.h);
    const imgUrl = await uploadS3(imgKey, imgBuf);

    await putItem({
      siteId:              SITE_ID,
      itemId,
      title:               d.title,
      body:                '',
      contentTypeId:       GALLERY_CT_ID,
      status:              'published',
      authorId:            AUTHOR_ID,
      siteContentTypeKey:  `${SITE_ID}#${GALLERY_CT_ID}`,
      fields: {
        file0: imgUrl,
        text0: d.caption,
        date0: d.date,
      },
      createdAt,
      updatedAt: createdAt,
    });

    console.log(`  ✅ ${itemId}`);
  }
}

// ─── エントリポイント ──────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log('🌱 newcleus テストデータ投入スクリプト');
  console.log(`   SITE_ID:     ${SITE_ID}`);
  console.log(`   NEWS_CT_ID:  ${NEWS_CT_ID}`);
  console.log(`   GALLERY_CT_ID: ${GALLERY_CT_ID}`);
  console.log(`   S3 Bucket:   ${S3_BUCKET || '(未設定)'}`);
  console.log(`   DRY_RUN:     ${DRY_RUN}`);

  if (!S3_BUCKET) {
    console.error('\n❌ S3_BUCKET_NAME が .env に設定されていません');
    process.exit(1);
  }

  if (DO_DELETE) {
    await deleteSeededItems(NEWS_CT_ID,    'お知らせ');
    await deleteSeededItems(GALLERY_CT_ID, 'フォトギャラリー');
    console.log('\n✅ 削除完了');
    return;
  }

  await seedNews();
  await seedGallery();

  console.log('\n✅ 投入完了！');
  console.log('   管理画面: https://d1sax4j5hw821p.cloudfront.net/admin');
  console.log('   サンプルページ: docs/embed-samples/news.html / photogallery.html');
}

main().catch((err: unknown) => {
  console.error('\n❌ エラー:', err instanceof Error ? err.message : err);
  process.exit(1);
});
