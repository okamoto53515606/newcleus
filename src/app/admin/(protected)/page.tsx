import Link from 'next/link';
import { BatchGetCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { getAdminUser } from '@/lib/admin-auth';
import { getDocClient, Tables } from '@/lib/dynamodb';
import type { SiteRecord } from '@/app/api/admin/sites/route';
import type { ContentTypeRecord } from '@/app/api/admin/sites/[siteId]/content-types/route';

export const dynamic = 'force-dynamic';

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ siteId?: string; ctId?: string }>;
}) {
  const params = await searchParams;
  const user = await getAdminUser();
  if (!user.isAuthenticated) return null;

  const db = getDocClient();
  let sites: SiteRecord[] = [];

  if (user.role === 'siteadmin' && user.siteIds && user.siteIds.length > 0) {
    const keys = user.siteIds.map((siteId) => ({ siteId }));
    const result = await db.send(
      new BatchGetCommand({
        RequestItems: {
          [Tables.sites]: { Keys: keys },
        },
      }),
    );
    sites = (result.Responses?.[Tables.sites] ?? []) as SiteRecord[];
  } else if (user.role === 'admin') {
    const result = await db.send(new ScanCommand({ TableName: Tables.sites }));
    sites = (result.Items ?? []) as SiteRecord[];
  }

  sites.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const selectedSiteId =
    (params.siteId && sites.some((site) => site.siteId === params.siteId) && params.siteId) ||
    sites[0]?.siteId;

  const selectedSite = sites.find((site) => site.siteId === selectedSiteId);

  let contentTypes: ContentTypeRecord[] = [];
  if (selectedSiteId) {
    const ctResult = await db.send(
      new QueryCommand({
        TableName: Tables.contentTypes,
        KeyConditionExpression: 'siteId = :siteId',
        ExpressionAttributeValues: { ':siteId': selectedSiteId },
      }),
    );
    contentTypes = (ctResult.Items ?? []) as ContentTypeRecord[];
    contentTypes.sort((a, b) => a.name.localeCompare(b.name));
  }

  return (
    <div className="space-y-6">
      <header className="admin-page-header">
        <h1>記事管理</h1>
      </header>

      <div className="admin-card">
        <h2 className="text-lg font-semibold text-gray-900">
          {selectedSite ? `${selectedSite.name} のコンテンツタイプ一覧` : 'サイトがありません'}
        </h2>

        {!selectedSite ? (
          <p className="text-sm text-gray-500 mt-4">アクセス可能なサイトがありません。</p>
        ) : contentTypes.length === 0 ? (
          <div className="mt-4">
            <p className="text-sm text-gray-500">このサイトにはコンテンツタイプがありません。</p>
            <Link
              href={`/admin/sites/${selectedSite.siteId}/content-types/new`}
              className="admin-btn admin-btn--primary mt-3"
            >
              コンテンツタイプを作成
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mt-4">
            {contentTypes.map((ct) => (
              <div
                key={ct.ctId}
                className="border border-gray-200 rounded-lg p-4 flex flex-col gap-2"
              >
                <p className="text-sm font-semibold text-gray-900">{ct.name}</p>
                <p className="text-xs text-gray-400">
                  SITE_ID: {selectedSite.siteId} / CT_ID: {ct.ctId}
                </p>
                <Link
                  href={`/admin/sites/${selectedSite.siteId}/items?contentTypeId=${ct.ctId}`}
                  className="admin-btn admin-btn--sm mt-auto self-start"
                >
                  記事一覧
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
