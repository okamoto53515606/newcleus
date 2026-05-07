import { NextRequest, NextResponse } from 'next/server';
import { getAdminUser } from '@/lib/admin-auth';
import { getDocClient, Tables } from '@/lib/dynamodb';
import { GetCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import type { ContentTypeRecord, FieldDefinition } from '../route';
import { randomBytes } from 'crypto';

export const dynamic = 'force-dynamic';

function canAccessSite(user: { role?: string; siteIds?: string[] }, siteId: string): boolean {
  if (user.role === 'admin') return true;
  if (user.role === 'siteadmin') return user.siteIds?.includes(siteId) ?? false;
  return false;
}

/**
 * GET /api/admin/sites/[siteId]/content-types/[ctId]
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string; ctId: string }> },
) {
  const user = await getAdminUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { siteId, ctId } = await params;
  if (!canAccessSite(user, siteId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDocClient();
  const result = await db.send(
    new GetCommand({ TableName: Tables.contentTypes, Key: { siteId, ctId } }),
  );
  if (!result.Item) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ contentType: result.Item as ContentTypeRecord });
}

/**
 * PUT /api/admin/sites/[siteId]/content-types/[ctId]
 * Body: { name?, description?, fields? }
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string; ctId: string }> },
) {
  const user = await getAdminUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { siteId, ctId } = await params;
  if (!canAccessSite(user, siteId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDocClient();
  const existing = await db.send(
    new GetCommand({ TableName: Tables.contentTypes, Key: { siteId, ctId } }),
  );
  if (!existing.Item) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  const current = existing.Item as ContentTypeRecord;

  const fields: FieldDefinition[] = Array.isArray(body.fields)
    ? body.fields.map((f: Partial<FieldDefinition>) => ({
        fieldId: f.fieldId || randomBytes(6).toString('hex'),
        name: String(f.name ?? '').trim().slice(0, 50) || 'field',
        type: (['text', 'textarea', 'richtext', 'number', 'boolean', 'date', 'image', 'select'] as const)
          .includes(f.type as FieldDefinition['type'])
          ? f.type!
          : 'text',
        required: Boolean(f.required),
        options: Array.isArray(f.options) ? f.options.map(String).slice(0, 50) : undefined,
      }))
    : current.fields;

  const updated: ContentTypeRecord = {
    ...current,
    name: typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 100) : current.name,
    description: typeof body.description === 'string' ? body.description.trim().slice(0, 500) : current.description,
    fields,
    updatedAt: new Date().toISOString(),
  };

  await db.send(new PutCommand({ TableName: Tables.contentTypes, Item: updated }));

  return NextResponse.json({ contentType: updated });
}

/**
 * DELETE /api/admin/sites/[siteId]/content-types/[ctId]
 * why: CloudFront は DELETE body を転送しないためパラメータはパスのみ
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string; ctId: string }> },
) {
  const user = await getAdminUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { siteId, ctId } = await params;
  if (!canAccessSite(user, siteId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDocClient();
  const existing = await db.send(
    new GetCommand({ TableName: Tables.contentTypes, Key: { siteId, ctId } }),
  );
  if (!existing.Item) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  await db.send(new DeleteCommand({ TableName: Tables.contentTypes, Key: { siteId, ctId } }));

  return NextResponse.json({ success: true });
}
