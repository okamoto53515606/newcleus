import { NextRequest, NextResponse } from 'next/server';
import { getAdminUser } from '@/lib/admin-auth';
import { getDocClient, Tables } from '@/lib/dynamodb';
import { GetCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import type { SiteRecord } from '../route';

/** Site 単体 API — GET / PUT / DELETE */

export const dynamic = 'force-dynamic';

/** ユーザーが対象サイトにアクセス可能かチェック */
function canAccessSite(user: { role?: string; siteIds?: string[] }, siteId: string): boolean {
  if (user.role === 'admin') return true;
  if (user.role === 'siteadmin') {
    return user.siteIds?.includes(siteId) ?? false;
  }
  return false;
}

/**
 * GET /api/admin/sites/[siteId]
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ siteId: string }> }) {
  const user = await getAdminUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { siteId } = await params;
  if (!canAccessSite(user, siteId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDocClient();
  const result = await db.send(new GetCommand({ TableName: Tables.sites, Key: { siteId } }));
  if (!result.Item) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ site: result.Item as SiteRecord });
}

/**
 * PUT /api/admin/sites/[siteId]
 * Body: { name? }
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ siteId: string }> }) {
  const user = await getAdminUser();
  // why: サイトの名称・設定変更は管理者権限が必要。
  //      siteadmin はコンテンツ編集のみ許可し、サイト設定変更は不可とする。
  if (!user || user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { siteId } = await params;

  const db = getDocClient();
  const existing = await db.send(new GetCommand({ TableName: Tables.sites, Key: { siteId } }));
  if (!existing.Item) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  const current = existing.Item as SiteRecord;
  const updated: SiteRecord = {
    ...current,
    name: typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 100) : current.name,
    updatedAt: new Date().toISOString(),
  };

  await db.send(new PutCommand({ TableName: Tables.sites, Item: updated }));

  return NextResponse.json({ site: updated });
}

/**
 * DELETE /api/admin/sites/[siteId]
 * admin のみ可能。
 * パラメータはクエリ文字列で渡す（CloudFront は DELETE body を転送しないため）。
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ siteId: string }> }) {
  const user = await getAdminUser();
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { siteId } = await params;

  const db = getDocClient();
  const existing = await db.send(new GetCommand({ TableName: Tables.sites, Key: { siteId } }));
  if (!existing.Item) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  await db.send(new DeleteCommand({ TableName: Tables.sites, Key: { siteId } }));

  return NextResponse.json({ success: true });
}
