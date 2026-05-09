import { NextRequest, NextResponse } from 'next/server';
import { DeleteCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { getAdminUser } from '@/lib/admin-auth';
import { getDocClient, Tables } from '@/lib/dynamodb';
import type { ItemRecord, ItemStatus, ItemFieldValue } from '../route';

export const dynamic = 'force-dynamic';

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
 * GET /api/admin/sites/[siteId]/items/[itemId]
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string; itemId: string }> },
) {
  const user = await getAdminUser();
  if (!user.isAuthenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { siteId, itemId } = await params;
  if (!canAccessSite(user, siteId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDocClient();
  const result = await db.send(
    new GetCommand({
      TableName: Tables.items,
      Key: { siteId, itemId },
    }),
  );

  if (!result.Item) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ item: result.Item as ItemRecord });
}

/**
 * PUT /api/admin/sites/[siteId]/items/[itemId]
 * Body: { title?, body?, contentTypeId?, status?, fields? }
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string; itemId: string }> },
) {
  const user = await getAdminUser();
  if (!user.isAuthenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { siteId, itemId } = await params;
  if (!canAccessSite(user, siteId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDocClient();
  const existing = await db.send(
    new GetCommand({
      TableName: Tables.items,
      Key: { siteId, itemId },
    }),
  );

  if (!existing.Item) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const payload = await req.json().catch(() => null);
  if (!payload || typeof payload !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const current = existing.Item as ItemRecord;

  const nextTitle =
    typeof payload.title === 'string'
      ? payload.title.trim().slice(0, TITLE_MAX_CHARS)
      : current.title;

  const nextBody =
    typeof payload.body === 'string'
      ? payload.body.trim()
      : current.body;

  const nextContentTypeId =
    typeof payload.contentTypeId === 'string' && payload.contentTypeId.trim()
      ? payload.contentTypeId.trim()
      : current.contentTypeId;

  const nextStatus: ItemStatus =
    payload.status === 'published' || payload.status === 'draft'
      ? payload.status
      : current.status;

  if (nextTitle.length > TITLE_MAX_CHARS) {
    return NextResponse.json({ error: `title は最大 ${TITLE_MAX_CHARS} 文字です` }, { status: 400 });
  }
  if (nextBody.length > BODY_MAX_CHARS) {
    return NextResponse.json({ error: `body は最大 ${BODY_MAX_CHARS} 文字です` }, { status: 400 });
  }

  // why: 更新時もサイト内に存在する CT のみに限定し、整合性を維持する
  const ct = await db.send(
    new GetCommand({
      TableName: Tables.contentTypes,
      Key: { siteId, ctId: nextContentTypeId },
    }),
  );
  if (!ct.Item) {
    return NextResponse.json({ error: 'contentType が見つかりません' }, { status: 400 });
  }

  const sanitized = payload.fields ? sanitizeFields(payload.fields) : null;
  if (sanitized && sanitized.errors.length > 0) {
    return NextResponse.json({ error: sanitized.errors[0] }, { status: 400 });
  }

  const updated: ItemRecord = {
    ...current,
    title: nextTitle,
    body: nextBody,
    contentTypeId: nextContentTypeId,
    status: nextStatus,
    fields: sanitized ? sanitized.fields : current.fields,
    siteContentTypeKey: `${siteId}#${nextContentTypeId}`,
    updatedAt: new Date().toISOString(),
  };

  await db.send(
    new PutCommand({
      TableName: Tables.items,
      Item: updated,
    }),
  );

  return NextResponse.json({ item: updated });
}

/**
 * DELETE /api/admin/sites/[siteId]/items/[itemId]
 * why: CloudFront は DELETE body を転送しないため、識別子はパスで受け取る
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string; itemId: string }> },
) {
  const user = await getAdminUser();
  if (!user.isAuthenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { siteId, itemId } = await params;
  if (!canAccessSite(user, siteId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDocClient();
  const existing = await db.send(
    new GetCommand({
      TableName: Tables.items,
      Key: { siteId, itemId },
    }),
  );

  if (!existing.Item) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  await db.send(
    new DeleteCommand({
      TableName: Tables.items,
      Key: { siteId, itemId },
    }),
  );

  return NextResponse.json({ success: true });
}
