import { NextRequest, NextResponse } from 'next/server';
import { getAdminUser } from '@/lib/admin-auth';
import { getDocClient, Tables } from '@/lib/dynamodb';
import { QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomBytes } from 'crypto';

export const dynamic = 'force-dynamic';

/**
 * コンテンツタイプのフィールド定義
 * why: DynamoDB の items テーブルは text0-9 / file0-9 / flag0-9 / date0-9 / num0-9
 *      の固定スロット構造。各 CT はそのうち使うスロットにラベルを付ける形。
 */
export interface FieldDefinition {
  fieldId: string; // スロット識別子: text0〜text9, file0〜file9, flag0〜flag9, date0〜date9, num0〜num9
  name: string;   // ラベル (例: "概要")
  type: 'text' | 'file' | 'flag' | 'date' | 'num';
}

function normalizeFieldType(raw: unknown): FieldDefinition['type'] {
  switch (String(raw)) {
    case 'text':
    case 'textarea':
    case 'richtext':
    case 'select':
      return 'text';
    case 'file':
    case 'image':
      return 'file';
    case 'flag':
    case 'boolean':
      return 'flag';
    case 'date':
      return 'date';
    case 'num':
    case 'number':
      return 'num';
    default:
      return 'text';
  }
}

/** コンテンツタイプのレコード */
export interface ContentTypeRecord {
  siteId: string;
  ctId: string;
  name: string;
  description?: string;
  fields: FieldDefinition[];
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
 * GET /api/admin/sites/[siteId]/content-types
 * サイト内のコンテンツタイプ一覧を返す
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  const user = await getAdminUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { siteId } = await params;
  if (!canAccessSite(user, siteId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDocClient();
  const result = await db.send(
    new QueryCommand({
      TableName: Tables.contentTypes,
      KeyConditionExpression: 'siteId = :siteId',
      ExpressionAttributeValues: { ':siteId': siteId },
    }),
  );

  const items = (result.Items ?? []) as ContentTypeRecord[];
  items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return NextResponse.json({ contentTypes: items });
}

/**
 * POST /api/admin/sites/[siteId]/content-types
 * コンテンツタイプを新規作成する
 *
 * Body: { name, description?, fields? }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  const user = await getAdminUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { siteId } = await params;
  if (!canAccessSite(user, siteId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || !body.name || typeof body.name !== 'string' || !body.name.trim()) {
    return NextResponse.json({ error: 'name は必須です' }, { status: 400 });
  }

  // fields バリデーション
  const fields: FieldDefinition[] = Array.isArray(body.fields)
    ? body.fields.map((f: Partial<FieldDefinition>) => ({
        fieldId: f.fieldId || randomBytes(6).toString('hex'),
        name: String(f.name ?? '').trim().slice(0, 50) || 'field',
        type: normalizeFieldType((f as { type?: unknown }).type),
      }))
    : [];

  const now = new Date().toISOString();
  const ct: ContentTypeRecord = {
    siteId,
    ctId: randomBytes(10).toString('hex'),
    name: body.name.trim().slice(0, 100),
    description: typeof body.description === 'string' ? body.description.trim().slice(0, 500) : undefined,
    fields,
    createdAt: now,
    updatedAt: now,
  };

  const db = getDocClient();
  await db.send(new PutCommand({ TableName: Tables.contentTypes, Item: ct }));

  return NextResponse.json({ contentType: ct }, { status: 201 });
}
