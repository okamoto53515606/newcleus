import { NextRequest, NextResponse } from 'next/server';
import { getAdminUser } from '@/lib/admin-auth';
import { getDocClient, Tables } from '@/lib/dynamodb';
import { GetCommand, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomBytes } from 'crypto';

export const dynamic = 'force-dynamic';

/** テンプレートレコード */
export interface TemplateRecord {
  ctId: string;
  templateId: string;
  siteId: string;
  name: string;
  shortname: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

/** ユーザーがサイトにアクセス可能か確認 */
function canAccessSite(user: { role?: string; siteIds?: string[] }, siteId: string): boolean {
  if (user.role === 'admin') return true;
  if (user.role === 'siteadmin') return user.siteIds?.includes(siteId) ?? false;
  return false;
}

/**
 * テンプレート body のサニタイズ
 * why: テンプレートは管理者（admin/siteadmin）が記述する信頼済みコンテンツ。
 *      記事 body と異なり <script> タグは許可する（/render フルHTML返却や
 *      embed.js 宿主ページ向けのモーダルJS等で必要）。
 *      ただし on* イベント属性はインラインスクリプトの混入を防ぐため除去する。
 */
function sanitizeTemplateBody(body: string): string {
  return body
    .replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '');
}

/** shortname の形式確認: 英小文字・数字・ハイフンのみ */
function isValidShortname(s: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(s);
}

// ─────────────────────────────────────────────────────────────
// GET /api/admin/sites/[siteId]/content-types/[ctId]/templates
// ─────────────────────────────────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ siteId: string; ctId: string }> },
) {
  const user = await getAdminUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { siteId, ctId } = await params;
  if (!canAccessSite(user, siteId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDocClient();

  // CT の存在確認（siteId 整合性チェックも兼ねる）
  const ctResult = await db.send(
    new GetCommand({
      TableName: Tables.contentTypes,
      Key: { siteId, ctId },
    }),
  );
  if (!ctResult.Item) {
    return NextResponse.json({ error: 'ContentType not found' }, { status: 404 });
  }

  const result = await db.send(
    new QueryCommand({
      TableName: Tables.templates,
      KeyConditionExpression: 'ctId = :ctId',
      ExpressionAttributeValues: { ':ctId': ctId },
    }),
  );

  const templates = ((result.Items ?? []) as TemplateRecord[]).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );

  return NextResponse.json({ templates });
}

// ──────────────────────────────────────────────────────────────
// POST /api/admin/sites/[siteId]/content-types/[ctId]/templates
// ──────────────────────────────────────────────────────────────
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string; ctId: string }> },
) {
  const user = await getAdminUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { siteId, ctId } = await params;
  if (!canAccessSite(user, siteId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { name, shortname, body: templateBody } = body as Record<string, unknown>;

  if (!name || typeof name !== 'string' || name.trim() === '') {
    return NextResponse.json({ error: 'name は必須です' }, { status: 400 });
  }
  if (!shortname || typeof shortname !== 'string' || !isValidShortname(shortname)) {
    return NextResponse.json(
      { error: 'shortname は英小文字・数字・ハイフンで入力してください' },
      { status: 400 },
    );
  }
  if (typeof templateBody !== 'string') {
    return NextResponse.json({ error: 'body は文字列で指定してください' }, { status: 400 });
  }

  const db = getDocClient();

  // CT の存在確認
  const ctResult = await db.send(
    new GetCommand({ TableName: Tables.contentTypes, Key: { siteId, ctId } }),
  );
  if (!ctResult.Item) {
    return NextResponse.json({ error: 'ContentType not found' }, { status: 404 });
  }

  const now = new Date().toISOString();
  const templateId = randomBytes(16).toString('hex');
  const sanitizedBody = sanitizeTemplateBody(templateBody);

  const item: TemplateRecord = {
    ctId,
    templateId,
    siteId,
    name: name.trim(),
    shortname,
    body: sanitizedBody,
    createdAt: now,
    updatedAt: now,
  };

  await db.send(new PutCommand({ TableName: Tables.templates, Item: item }));

  return NextResponse.json({ template: item }, { status: 201 });
}
