/**
 * テンプレート一覧ページ
 * why: コンテンツタイプごとに複数テンプレートを管理できる設定画面。
 *      embed.js の SSR で使用するテンプレートを選択・確認する起点となる。
 */

import { getDocClient, Tables } from '@/lib/dynamodb';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getAdminUser } from '@/lib/admin-auth';
import Link from 'next/link';
import type { SiteRecord } from '@/app/api/admin/sites/route';
import type { ContentTypeRecord } from '@/app/api/admin/sites/[siteId]/content-types/route';
import type { TemplateRecord } from '@/app/api/admin/sites/[siteId]/content-types/[ctId]/templates/route';

export const dynamic = 'force-dynamic';

export default async function TemplatesPage({
  params,
}: {
  params: Promise<{ siteId: string; ctId: string }>;
}) {
  const { siteId, ctId } = await params;
  const user = await getAdminUser();
  if (!user) return null;

  const db = getDocClient();

  const [siteResult, ctResult, tmplResult] = await Promise.all([
    db.send(new GetCommand({ TableName: Tables.sites, Key: { siteId } })),
    db.send(new GetCommand({ TableName: Tables.contentTypes, Key: { siteId, ctId } })),
    db.send(
      new QueryCommand({
        TableName: Tables.templates,
        KeyConditionExpression: 'ctId = :ctId',
        ExpressionAttributeValues: { ':ctId': ctId },
      }),
    ),
  ]);

  if (!siteResult.Item) return <p className="text-red-500">サイトが見つかりません</p>;
  if (!ctResult.Item) return <p className="text-red-500">コンテンツタイプが見つかりません</p>;

  const site = siteResult.Item as SiteRecord;
  const ct = ctResult.Item as ContentTypeRecord;
  const templates = ((tmplResult.Items ?? []) as TemplateRecord[]).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <nav className="text-sm text-gray-500 mb-1">
            <Link href={`/admin/sites/${siteId}/content-types`} className="hover:underline text-gray-700">
              {site.name}
            </Link>{' '}
            &gt;{' '}
            <Link
              href={`/admin/sites/${siteId}/content-types/${ctId}/edit`}
              className="hover:underline text-gray-700"
            >
              {ct.name}
            </Link>{' '}
            &gt;{' '}
            <span className="text-gray-700">テンプレート</span>
          </nav>
          <h1 className="text-2xl font-bold text-gray-900">{ct.name}のテンプレート</h1>
          <p className="text-sm text-gray-500 mt-1">
            embed.js で使用する Handlebars テンプレートを管理します
          </p>
        </div>
        <Link
          href={`/admin/sites/${siteId}/content-types/${ctId}/templates/new`}
          className="admin-btn admin-btn--primary"
        >
          + 新規テンプレート
        </Link>
      </div>

      {templates.length === 0 ? (
        <div className="admin-card text-center py-12">
          <p className="text-gray-500 mb-4">テンプレートがまだありません</p>
          <Link
            href={`/admin/sites/${siteId}/content-types/${ctId}/templates/new`}
            className="admin-btn admin-btn--primary"
          >
            最初のテンプレートを作成する
          </Link>
        </div>
      ) : (
        <div className="admin-card overflow-hidden p-0">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  テンプレート名
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  shortname
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  更新日
                </th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {templates.map((tmpl) => (
                <tr key={tmpl.templateId} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">{tmpl.name}</td>
                  <td className="px-6 py-4 text-sm text-gray-600 font-mono">{tmpl.shortname}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {new Date(tmpl.updatedAt).toLocaleDateString('ja-JP')}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Link
                      href={`/admin/sites/${siteId}/content-types/${ctId}/templates/${tmpl.templateId}/edit`}
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
