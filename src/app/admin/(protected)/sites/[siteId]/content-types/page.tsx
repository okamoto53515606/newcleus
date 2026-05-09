import { getDocClient, Tables } from '@/lib/dynamodb';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getAdminUser } from '@/lib/admin-auth';
import Link from 'next/link';
import type { ContentTypeRecord } from '@/app/api/admin/sites/[siteId]/content-types/route';
import type { SiteRecord } from '@/app/api/admin/sites/route';

export const dynamic = 'force-dynamic';

export default async function ContentTypesPage({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  const user = await getAdminUser();
  if (!user) return null;

  const db = getDocClient();

  const [siteResult, ctResult] = await Promise.all([
    db.send(new GetCommand({ TableName: Tables.sites, Key: { siteId } })),
    db.send(
      new QueryCommand({
        TableName: Tables.contentTypes,
        KeyConditionExpression: 'siteId = :siteId',
        ExpressionAttributeValues: { ':siteId': siteId },
      }),
    ),
  ]);

  if (!siteResult.Item) {
    return <p className="text-red-500">サイトが見つかりません</p>;
  }

  const site = siteResult.Item as SiteRecord;
  const cts = ((ctResult.Items ?? []) as ContentTypeRecord[]).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <nav className="text-sm text-gray-500 mb-1">
            <Link href="/admin/sites" className="hover:underline">
              設定
            </Link>{' '}
            / <span className="text-gray-700">{site.name}</span>
          </nav>
          <h1 className="text-2xl font-bold text-gray-900">コンテンツタイプ</h1>
          <p className="text-sm text-gray-500 mt-1">
            このサイトのコンテンツタイプ設定を行います
          </p>
        </div>
        <Link
          href={`/admin/sites/${siteId}/content-types/new`}
          className="admin-btn admin-btn--primary"
        >
          + 新規コンテンツタイプ
        </Link>
      </div>

      {cts.length === 0 ? (
        <div className="admin-card text-center py-12">
          <p className="text-gray-500 mb-4">コンテンツタイプがまだありません</p>
          <Link
            href={`/admin/sites/${siteId}/content-types/new`}
            className="admin-btn admin-btn--primary"
          >
            最初のコンテンツタイプを作成する
          </Link>
        </div>
      ) : (
        <div className="admin-card overflow-hidden p-0">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  コンテンツタイプ名
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  フィールド数
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  更新日
                </th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {cts.map((ct) => (
                <tr key={ct.ctId} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <p className="text-sm font-medium text-gray-900">{ct.name}</p>
                    {ct.description && (
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">
                        {ct.description}
                      </p>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">{ct.fields.length}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {new Date(ct.updatedAt).toLocaleDateString('ja-JP')}
                  </td>
                  <td className="px-6 py-4 text-right space-x-2">
                    <Link
                      href={`/admin/sites/${siteId}/content-types/${ct.ctId}/templates`}
                      className="admin-btn text-xs"
                    >
                      テンプレート
                    </Link>
                    <Link
                      href={`/admin/sites/${siteId}/content-types/${ct.ctId}/edit`}
                      className="admin-btn text-xs"
                    >
                      編集
                    </Link>
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
