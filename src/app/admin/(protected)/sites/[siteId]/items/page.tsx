import Link from 'next/link';
import { redirect } from 'next/navigation';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getAdminUser } from '@/lib/admin-auth';
import { getDocClient, Tables } from '@/lib/dynamodb';
import type { SiteRecord } from '@/app/api/admin/sites/route';
import type { ContentTypeRecord } from '@/app/api/admin/sites/[siteId]/content-types/route';
import type { ItemRecord } from '@/app/api/admin/sites/[siteId]/items/route';
import PaginationControls from '@/components/admin/pagination-controls';

export const dynamic = 'force-dynamic';

function formatDateYmd(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function canAccessSite(user: { role?: string; siteIds?: string[] }, siteId: string): boolean {
  if (user.role === 'admin') return true;
  if (user.role === 'siteadmin') return user.siteIds?.includes(siteId) ?? false;
  return false;
}

export default async function SiteItemsPage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{ contentTypeId?: string; page?: string }>;
}) {
  const { siteId } = await params;
  const q = await searchParams;
  const user = await getAdminUser();

  if (!user.isAuthenticated || !canAccessSite(user, siteId)) {
    return <p className="text-sm text-red-600">このサイトの記事にアクセスする権限がありません。</p>;
  }

  const db = getDocClient();
  const [siteResult, itemsResult, contentTypesResult] = await Promise.all([
    db.send(new GetCommand({ TableName: Tables.sites, Key: { siteId } })),
    db.send(
      new QueryCommand({
        TableName: Tables.items,
        KeyConditionExpression: 'siteId = :siteId',
        ExpressionAttributeValues: { ':siteId': siteId },
      }),
    ),
    db.send(
      new QueryCommand({
        TableName: Tables.contentTypes,
        KeyConditionExpression: 'siteId = :siteId',
        ExpressionAttributeValues: { ':siteId': siteId },
      }),
    ),
  ]);

  if (!siteResult.Item) {
    return <p className="text-sm text-red-600">サイトが見つかりません。</p>;
  }

  const site = siteResult.Item as SiteRecord;
  const contentTypes = (contentTypesResult.Items ?? []) as ContentTypeRecord[];
  const ctNameMap = new Map(contentTypes.map((ct) => [ct.ctId, ct.name]));

  if (contentTypes.length === 0) {
    return (
      <div className="admin-card">
        <p className="text-sm text-gray-600">このサイトにはコンテンツタイプがありません。</p>
        <Link
          href={`/admin/sites/${siteId}/content-types/new`}
          className="admin-btn admin-btn--primary mt-3"
        >
          コンテンツタイプを作成
        </Link>
      </div>
    );
  }

  const requestedCtId = q.contentTypeId;
  const activeCtId =
    (requestedCtId && contentTypes.some((ct) => ct.ctId === requestedCtId) && requestedCtId) ||
    contentTypes[0].ctId;

  if (!requestedCtId || requestedCtId !== activeCtId) {
    redirect(`/admin/sites/${siteId}/items?contentTypeId=${activeCtId}&page=1`);
  }

  const allItems = ((itemsResult.Items ?? []) as ItemRecord[])
    .filter((item) => item.contentTypeId === activeCtId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const currentPage = Math.max(1, Number.parseInt(q.page ?? '1', 10) || 1);
  const pageSize = 20;
  const start = (currentPage - 1) * pageSize;
  const pagedItems = allItems.slice(start, start + pageSize);
  const hasMore = start + pageSize < allItems.length;
  const activeCtName = ctNameMap.get(activeCtId) ?? 'コンテンツタイプ';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <nav className="text-sm text-gray-500 mb-1">
            <Link href={`/admin?siteId=${siteId}`} className="hover:underline text-gray-700">
              {site.name}
            </Link>{' / '}
            <span className="text-gray-900">{activeCtName}の記事一覧</span>
          </nav>
          <h1 className="text-2xl font-bold text-gray-900">{activeCtName}の記事一覧</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/admin/sites/${siteId}/items/new?contentTypeId=${activeCtId}`}
            className="admin-btn admin-btn--primary"
          >
            + 新規記事
          </Link>
        </div>
      </div>

      {pagedItems.length === 0 ? (
        <div className="admin-card text-center py-12">
          <p className="text-gray-500 mb-4">記事がまだありません</p>
          <Link
            href={`/admin/sites/${siteId}/items/new?contentTypeId=${activeCtId}`}
            className="admin-btn admin-btn--primary"
          >
            最初の記事を作成する
          </Link>
        </div>
      ) : (
        <div className="admin-card overflow-hidden p-0">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  タイトル
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  作成日
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  状態
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  更新日
                </th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {pagedItems.map((item) => (
                <tr key={item.itemId} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <p className="text-sm font-medium text-gray-900">{item.title}</p>
                    <p className="text-xs text-gray-400 font-mono mt-0.5">{item.itemId}</p>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">{formatDateYmd(item.createdAt)}</td>
                  <td className="px-6 py-4 text-sm">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        item.status === 'published'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {item.status === 'published' ? '公開' : '下書き'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {formatDateYmd(item.updatedAt)}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Link
                      href={`/admin/sites/${siteId}/items/${item.itemId}/edit`}
                      className="admin-btn admin-btn--sm"
                    >
                      編集
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-6 pb-4">
            <PaginationControls
              currentPage={currentPage}
              hasMore={hasMore}
              basePath={`/admin/sites/${siteId}/items`}
            />
          </div>
        </div>
      )}
    </div>
  );
}
