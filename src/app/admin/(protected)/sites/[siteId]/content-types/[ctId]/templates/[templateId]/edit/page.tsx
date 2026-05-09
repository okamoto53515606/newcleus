/**
 * テンプレート編集ページ
 * why: サーバーコンポーネントで既存テンプレートを取得し、
 *      TemplateForm に初期値として渡すことで編集モードで表示する。
 */

import { getDocClient, Tables } from '@/lib/dynamodb';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { getAdminUser } from '@/lib/admin-auth';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import TemplateForm from '../../components/template-form';
import type { SiteRecord } from '@/app/api/admin/sites/route';
import type { ContentTypeRecord } from '@/app/api/admin/sites/[siteId]/content-types/route';
import type { TemplateRecord } from '@/app/api/admin/sites/[siteId]/content-types/[ctId]/templates/route';

export const dynamic = 'force-dynamic';

export default async function EditTemplatePage({
  params,
}: {
  params: Promise<{ siteId: string; ctId: string; templateId: string }>;
}) {
  const { siteId, ctId, templateId } = await params;
  const user = await getAdminUser();
  if (!user) return null;

  const db = getDocClient();
  const [siteResult, ctResult, tmplResult] = await Promise.all([
    db.send(new GetCommand({ TableName: Tables.sites, Key: { siteId } })),
    db.send(new GetCommand({ TableName: Tables.contentTypes, Key: { siteId, ctId } })),
    db.send(new GetCommand({ TableName: Tables.templates, Key: { ctId, templateId } })),
  ]);

  if (!siteResult.Item) return <p className="text-red-500">サイトが見つかりません</p>;
  if (!ctResult.Item) return <p className="text-red-500">コンテンツタイプが見つかりません</p>;
  if (!tmplResult.Item || tmplResult.Item.siteId !== siteId) notFound();

  const site = siteResult.Item as SiteRecord;
  const ct = ctResult.Item as ContentTypeRecord;
  const template = tmplResult.Item as TemplateRecord;

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
          <span className="text-gray-900">テンプレート編集</span>
        </nav>
        <h1 className="text-2xl font-bold text-gray-900">テンプレート編集</h1>
      </div>

      <div className="admin-card">
        <TemplateForm siteId={siteId} ctId={ctId} initial={template} fields={ct.fields} />
      </div>
    </div>
  );
}
