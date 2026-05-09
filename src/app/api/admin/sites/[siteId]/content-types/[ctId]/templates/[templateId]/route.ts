import { NextRequest, NextResponse } from 'next/server';
import { getAdminUser } from '@/lib/admin-auth';
import { getDocClient, Tables } from '@/lib/dynamodb';
import { GetCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import type { TemplateRecord } from '../route';

export const dynamic = 'force-dynamic';

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

type RouteContext = { params: Promise<{ siteId: string; ctId: string; templateId: string }> };

// ─────────────────────────────────────────────────────────────────────────────────
// GET /api/admin/sites/[siteId]/content-types/[ctId]/templates/[templateId]
// ─────────────────────────────────────────────────────────────────────────────────
export async function GET(_req: NextRequest, { params }: RouteContext) {
  const user = await getAdminUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { siteId, ctId, templateId } = await params;
  if (!canAccessSite(user, siteId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDocClient();
  const result = await db.send(
    new GetCommand({ TableName: Tables.templates, Key: { ctId, templateId } }),
  );

  if (!result.Item || result.Item.siteId !== siteId) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  return NextResponse.json({ template: result.Item as TemplateRecord });
}

// ─────────────────────────────────────────────────────────────────────────────────
// PUT /api/admin/sites/[siteId]/content-types/[ctId]/templates/[templateId]
// ─────────────────────────────────────────────────────────────────────────────────
export async function PUT(req: NextRequest, { params }: RouteContext) {
  const user = await getAdminUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { siteId, ctId, templateId } = await params;
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

  // 存在確認 + siteId 整合性チェック
  const existing = await db.send(
    new GetCommand({ TableName: Tables.templates, Key: { ctId, templateId } }),
  );
  if (!existing.Item || existing.Item.siteId !== siteId) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  const now = new Date().toISOString();
  const sanitizedBody = sanitizeTemplateBody(templateBody);

  await db.send(
    new UpdateCommand({
      TableName: Tables.templates,
      Key: { ctId, templateId },
      UpdateExpression:
        'SET #name = :name, shortname = :shortname, #body = :body, updatedAt = :updatedAt',
      ExpressionAttributeNames: { '#name': 'name', '#body': 'body' },
      ExpressionAttributeValues: {
        ':name': name.trim(),
        ':shortname': shortname,
        ':body': sanitizedBody,
        ':updatedAt': now,
      },
    }),
  );

  return NextResponse.json({ ok: true });
}

// ─────────────────────────────────────────────────────────────────────────────────
// DELETE /api/admin/sites/[siteId]/content-types/[ctId]/templates/[templateId]
// why: CloudFront は DELETE の body を転送しないため、識別子はパスパラメータで渡す
// ─────────────────────────────────────────────────────────────────────────────────
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const user = await getAdminUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { siteId, ctId, templateId } = await params;
  if (!canAccessSite(user, siteId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDocClient();

  // 存在確認 + siteId 整合性チェック
  const existing = await db.send(
    new GetCommand({ TableName: Tables.templates, Key: { ctId, templateId } }),
  );
  if (!existing.Item || existing.Item.siteId !== siteId) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  await db.send(
    new DeleteCommand({ TableName: Tables.templates, Key: { ctId, templateId } }),
  );

  return NextResponse.json({ ok: true });
}
