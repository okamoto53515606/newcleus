/**
 * テンプレート新規作成ページ
 * why: サーバーコンポーネントでサイト・CTの情報を取得してパンくずを表示し、
 *      フォーム自体はクライアントコンポーネント（TemplateForm）に委譲する。
 */

import { getDocClient, Tables } from '@/lib/dynamodb';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { getAdminUser } from '@/lib/admin-auth';
import Link from 'next/link';
import TemplateForm from '../components/template-form';
import type { SiteRecord } from '@/app/api/admin/sites/route';
import type { ContentTypeRecord } from '@/app/api/admin/sites/[siteId]/content-types/route';

export const dynamic = 'force-dynamic';

export default async function NewTemplatePage({
  params,
}: {
  params: Promise<{ siteId: string; ctId: string }>;
}) {
  const { siteId, ctId } = await params;
  const user = await getAdminUser();
  if (!user) return null;

  const db = getDocClient();
  const [siteResult, ctResult] = await Promise.all([
    db.send(new GetCommand({ TableName: Tables.sites, Key: { siteId } })),
    db.send(new GetCommand({ TableName: Tables.contentTypes, Key: { siteId, ctId } })),
  ]);

  if (!siteResult.Item) return <p className="text-red-500">サイトが見つかりません</p>;
  if (!ctResult.Item) return <p className="text-red-500">コンテンツタイプが見つかりません</p>;

  const site = siteResult.Item as SiteRecord;
  const ct = ctResult.Item as ContentTypeRecord;

  return (
    <div className="space-y-6">
      <div>
        <nav className="text-sm text-gray-500 mb-1">
          <Link href="/admin/sites" className="hover:underline text-gray-500">設定</Link>
          {' / '}
          <span className="text-gray-700">{site.name}</span>
          {' / '}
          <Link href={`/admin/sites/${siteId}/content-types`} className="hover:underline text-gray-700">
            コンテンツタイプ一覧
          </Link>
          {' / '}
          <Link href={`/admin/sites/${siteId}/content-types/${ctId}/templates`} className="hover:underline text-gray-700">
            テンプレート一覧
          </Link>
          {' / '}
          <span className="text-gray-900">テンプレート新規作成</span>
        </nav>
        <h1 className="text-2xl font-bold text-gray-900">テンプレート新規作成</h1>
      </div>

      <div className="admin-card">
        <TemplateForm siteId={siteId} ctId={ctId} fields={ct.fields} />
      </div>
    </div>
  );
}
