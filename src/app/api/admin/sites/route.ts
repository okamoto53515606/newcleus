import { NextRequest, NextResponse } from 'next/server';
import { getAdminUser } from '@/lib/admin-auth';
import { getDocClient, Tables } from '@/lib/dynamodb';
import { ScanCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomBytes } from 'crypto';

/** Sites API — GET 一覧 / POST 作成 */

export const dynamic = 'force-dynamic';

// サイト情報の型（DB設計書 §1 newcleus-sites に準拠）
export interface SiteRecord {
  siteId: string;
  name: string;
  shortname: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * GET /api/admin/sites
 * サイト一覧を返す。
 * role=admin: 全サイト
 * role=siteadmin: 自分が属するサイトのみ
 */
export async function GET(req: NextRequest) {
  const user = await getAdminUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDocClient();

  // siteadmin は自分に割り当てられたサイトのみ取得
  // admin は全件 Scan
  // why: siteadmin が他テナントのデータを取得できないよう、サーバー側でフィルタリングする
  if (user.role === 'siteadmin' && user.siteIds && user.siteIds.length > 0) {
    const { BatchGetCommand } = await import('@aws-sdk/lib-dynamodb');
    const keys = user.siteIds.map((siteId: string) => ({ siteId }));
    const result = await db.send(
      new BatchGetCommand({
        RequestItems: {
          [Tables.sites]: { Keys: keys },
        },
      }),
    );
    const items = (result.Responses?.[Tables.sites] ?? []) as SiteRecord[];
    items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return NextResponse.json({ sites: items });
  }

  if (user.role !== 'admin') {
    return NextResponse.json({ sites: [] });
  }

  const result = await db.send(new ScanCommand({ TableName: Tables.sites }));
  const items = (result.Items ?? []) as SiteRecord[];
  items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return NextResponse.json({ sites: items });
}

/**
 * POST /api/admin/sites
 * 新規サイトを作成する。admin のみ可能。
 *
 * Body: { name, shortname }
 */
export async function POST(req: NextRequest) {
  const user = await getAdminUser();
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || !body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
    return NextResponse.json({ error: 'name は必須です' }, { status: 400 });
  }
  if (!body.shortname || typeof body.shortname !== 'string' || !/^[a-z0-9-]+$/.test(body.shortname.trim())) {
    return NextResponse.json({ error: 'shortname は英小文字・数字・ハイフンのみ使用できます' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const site: SiteRecord = {
    siteId: randomBytes(10).toString('hex'),
    name: body.name.trim().slice(0, 100),
    shortname: body.shortname.trim().slice(0, 50),
    createdAt: now,
    updatedAt: now,
  };

  const db = getDocClient();
  await db.send(new PutCommand({ TableName: Tables.sites, Item: site }));

  return NextResponse.json({ site }, { status: 201 });
}
