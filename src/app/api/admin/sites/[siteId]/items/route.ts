import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getAdminUser } from '@/lib/admin-auth';
import { getDocClient, Tables } from '@/lib/dynamodb';

export const dynamic = 'force-dynamic';

export type ItemStatus = 'published' | 'draft';
export type ItemFieldValue = string | number | boolean;

const TITLE_MAX_CHARS = 200;
const BODY_MAX_CHARS = 20_000;
const TEXT_FIELD_MAX_CHARS = 20_000;
const FILE_FIELD_MAX_CHARS = 2_048;
const NUM_MIN = -999_999_999;
const NUM_MAX = 999_999_999;

function isValidDateValue(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return false;
  return date.toISOString().slice(0, 10) === value;
}

export interface ItemRecord {
  siteId: string;
  itemId: string;
  title: string;
  body: string;
  contentTypeId: string;
  status: ItemStatus;
  authorId: string;
  fields: Record<string, ItemFieldValue>;
  siteContentTypeKey: string;
  createdAt: string;
  updatedAt: string;
}

function canAccessSite(user: { role?: string; siteIds?: string[] }, siteId: string): boolean {
  if (user.role === 'admin') return true;
  if (user.role === 'siteadmin') return user.siteIds?.includes(siteId) ?? false;
  return false;
}

function isValidFieldId(fieldId: string): boolean {
  return /^(text|file|flag|date|num)[0-9]$/.test(fieldId);
}

function sanitizeFields(input: unknown): { fields: Record<string, ItemFieldValue>; errors: string[] } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { fields: {}, errors: [] };
  }

  const fields: Record<string, ItemFieldValue> = {};
  const errors: string[] = [];

  for (const [fieldId, value] of Object.entries(input as Record<string, unknown>)) {
    if (!isValidFieldId(fieldId)) continue;

    if (fieldId.startsWith('flag')) {
      fields[fieldId] = Boolean(value);
      continue;
    }

    if (fieldId.startsWith('num')) {
      const parsed =
        typeof value === 'number'
          ? value
          : typeof value === 'string' && value.trim() !== ''
            ? Number(value)
            : null;

      if (parsed === null) continue;
      if (!Number.isFinite(parsed) || parsed < NUM_MIN || parsed > NUM_MAX) {
        errors.push(`${fieldId} は ${NUM_MIN} から ${NUM_MAX} の範囲で入力してください`);
        continue;
      }

      fields[fieldId] = parsed;
      continue;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (fieldId.startsWith('text') && trimmed.length > TEXT_FIELD_MAX_CHARS) {
        errors.push(`${fieldId} は最大 ${TEXT_FIELD_MAX_CHARS} 文字です`);
        continue;
      }
      if (fieldId.startsWith('file') && trimmed.length > FILE_FIELD_MAX_CHARS) {
        errors.push(`${fieldId} のURLは最大 ${FILE_FIELD_MAX_CHARS} 文字です`);
        continue;
      }
      if (fieldId.startsWith('date') && trimmed !== '' && !isValidDateValue(trimmed)) {
        errors.push(`${fieldId} は YYYY-MM-DD 形式で入力してください`);
        continue;
      }
      fields[fieldId] = trimmed;
    }
  }

  return { fields, errors };
}

/**
 * GET /api/admin/sites/[siteId]/items
 * クエリ: contentTypeId?, status?
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  const user = await getAdminUser();
  if (!user.isAuthenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { siteId } = await params;
  if (!canAccessSite(user, siteId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const contentTypeId = req.nextUrl.searchParams.get('contentTypeId')?.trim();
  const status = req.nextUrl.searchParams.get('status')?.trim();

  const db = getDocClient();
  const result = await db.send(
    new QueryCommand({
      TableName: Tables.items,
      KeyConditionExpression: 'siteId = :siteId',
      ExpressionAttributeValues: { ':siteId': siteId },
    }),
  );

  let items = (result.Items ?? []) as ItemRecord[];

  if (contentTypeId) {
    items = items.filter((item) => item.contentTypeId === contentTypeId);
  }
  if (status === 'published' || status === 'draft') {
    items = items.filter((item) => item.status === status);
  }

  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return NextResponse.json({ items });
}

/**
 * POST /api/admin/sites/[siteId]/items
 * Body: { title?, body?, contentTypeId, status, fields }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  const user = await getAdminUser();
  if (!user.isAuthenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { siteId } = await params;
  if (!canAccessSite(user, siteId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const htmlBody = typeof body.body === 'string' ? body.body.trim() : '';
  const contentTypeId = typeof body.contentTypeId === 'string' ? body.contentTypeId.trim() : '';
  const status = body.status === 'draft' ? 'draft' : body.status === 'published' ? 'published' : null;

  if (title.length > TITLE_MAX_CHARS) {
    return NextResponse.json({ error: `title は最大 ${TITLE_MAX_CHARS} 文字です` }, { status: 400 });
  }
  if (htmlBody.length > BODY_MAX_CHARS) {
    return NextResponse.json({ error: `body は最大 ${BODY_MAX_CHARS} 文字です` }, { status: 400 });
  }
  if (!contentTypeId) {
    return NextResponse.json({ error: 'contentTypeId は必須です' }, { status: 400 });
  }
  if (!status) {
    return NextResponse.json({ error: 'status は published または draft を指定してください' }, { status: 400 });
  }

  // why: 異なるサイトの contentTypeId を誤って指定しても保存できないようにする
  const db = getDocClient();
  const ct = await db.send(
    new GetCommand({
      TableName: Tables.contentTypes,
      Key: { siteId, ctId: contentTypeId },
    }),
  );
  if (!ct.Item) {
    return NextResponse.json({ error: 'contentType が見つかりません' }, { status: 400 });
  }

  const { fields, errors } = sanitizeFields(body.fields);
  if (errors.length > 0) {
    return NextResponse.json({ error: errors[0] }, { status: 400 });
  }

  const now = new Date().toISOString();
  const item: ItemRecord = {
    siteId,
    itemId: randomBytes(10).toString('hex'),
    title: title.slice(0, TITLE_MAX_CHARS),
    body: htmlBody,
    contentTypeId,
    status,
    authorId: user.sub ?? 'unknown',
    fields,
    siteContentTypeKey: `${siteId}#${contentTypeId}`,
    createdAt: now,
    updatedAt: now,
  };

  await db.send(
    new PutCommand({
      TableName: Tables.items,
      Item: item,
    }),
  );

  return NextResponse.json({ item }, { status: 201 });
}
