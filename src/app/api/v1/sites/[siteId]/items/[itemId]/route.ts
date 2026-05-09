/**
 * 公開 API — 記事単体取得
 *
 * GET /api/v1/sites/{siteId}/items/{itemId}
 *
 * why: itemId 直接指定での記事取得。published のみ返却。
 *      draft 記事は 404 を返し、下書きの存在を外部に露出しない。
 */

import { NextRequest, NextResponse } from 'next/server';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import {
  CORS_HEADERS,
  isSafeId,
  fetchSite,
  fetchContentType,
  toPublicItem,
} from '@/lib/public-api';
import { getDocClient, Tables } from '@/lib/dynamodb';
import type { ItemRecord } from '@/app/api/admin/sites/[siteId]/items/route';

export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ siteId: string; itemId: string }> },
) {
  const { siteId, itemId } = await params;

  if (!isSafeId(siteId) || !isSafeId(itemId)) {
    return NextResponse.json(
      { error: 'Invalid parameter' },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  // site 存在確認と item 取得を並列実行
  const [site, itemResult] = await Promise.all([
    fetchSite(siteId),
    getDocClient().send(
      new GetCommand({ TableName: Tables.items, Key: { siteId, itemId } }),
    ),
  ]);

  if (!site || !itemResult.Item) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: CORS_HEADERS });
  }

  const item = itemResult.Item as ItemRecord;

  // why: 下書き記事は公開 API では取得不可。404 を返すことで存在を外部に露出しない。
  if (item.status !== 'published') {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: CORS_HEADERS });
  }

  const ct = await fetchContentType(siteId, item.contentTypeId);
  if (!ct) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: CORS_HEADERS });
  }

  return NextResponse.json({ item: toPublicItem(item, ct) }, { headers: CORS_HEADERS });
}
