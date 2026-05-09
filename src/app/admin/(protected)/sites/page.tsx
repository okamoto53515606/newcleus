import { getAdminUser } from '@/lib/admin-auth';
import { getDocClient, Tables } from '@/lib/dynamodb';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import Link from 'next/link';
import type { SiteRecord } from '@/app/api/admin/sites/route';

export const dynamic = 'force-dynamic';

export default async function SitesPage() {
  // サーバーコンポーネントから直接 DB 参照
  // why: API Route 経由だと同一 Lambda 内でループするため、RSC では SDK を直接使う。
  //      認証は admin-auth の getAdminUser で確認（layout で確認済みだが二重確認）。
  const user = await getAdminUser();

  if (!user) return null; // layout でリダイレクト済み

  const db = getDocClient();
  let sites: SiteRecord[] = [];

  if (user.role === 'siteadmin' && user.siteIds && user.siteIds.length > 0) {
    const keys = user.siteIds.map((siteId: string) => ({ siteId }));
    const result = await db.send(
      new BatchGetCommand({ RequestItems: { [Tables.sites]: { Keys: keys } } }),
    );
    sites = (result.Responses?.[Tables.sites] ?? []) as SiteRecord[];
  } else if (user.role === 'admin') {
    const result = await db.send(new ScanCommand({ TableName: Tables.sites }));
    sites = (result.Items ?? []) as SiteRecord[];
  }

  sites.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">設定</h1>
          <p className="text-sm text-gray-500 mt-1">
            サイト登録（admin）とコンテンツタイプ設定（admin/siteadmin）を行います
          </p>
        </div>
        {user.role === 'admin' && (
          <Link href="/admin/sites/new" className="admin-btn admin-btn--primary">
            + 新規サイト
          </Link>
        )}
      </div>

      {sites.length === 0 ? (
        <div className="admin-card text-center py-12">
          <p className="text-gray-500 mb-4">サイトがまだありません</p>
          {user.role === 'admin' && (
            <Link href="/admin/sites/new" className="admin-btn admin-btn--primary">
              最初のサイトを作成する
            </Link>
          )}
        </div>
      ) : (
        <div className="admin-card overflow-hidden p-0">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  サイト名
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  SITE_ID
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  作成日
                </th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {sites.map((site) => (
                <tr key={site.siteId} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <p className="text-sm font-medium text-gray-900">{site.name}</p>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500 font-mono">{site.siteId}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {new Date(site.createdAt).toLocaleDateString('ja-JP')}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/admin/sites/${site.siteId}/content-types`}
                        className="admin-btn text-xs"
                      >
                        コンテンツタイプ設定
                      </Link>
                      {user.role === 'admin' && (
                        <Link
                          href={`/admin/sites/${site.siteId}/edit`}
                          className="admin-btn text-xs"
                        >
                          編集
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
