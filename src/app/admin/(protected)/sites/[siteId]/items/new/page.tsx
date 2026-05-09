import Link from 'next/link';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { getAdminUser } from '@/lib/admin-auth';
import { getDocClient, Tables } from '@/lib/dynamodb';
import type { SiteRecord } from '@/app/api/admin/sites/route';
import type { ContentTypeRecord } from '@/app/api/admin/sites/[siteId]/content-types/route';
import { ItemForm } from '../components/item-form';

export const dynamic = 'force-dynamic';

function canAccessSite(user: { role?: string; siteIds?: string[] }, siteId: string): boolean {
  if (user.role === 'admin') return true;
  if (user.role === 'siteadmin') return user.siteIds?.includes(siteId) ?? false;
  return false;
}

export default async function NewItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{ contentTypeId?: string }>;
}) {
  const { siteId } = await params;
  const q = await searchParams;
  const contentTypeId = q.contentTypeId ?? '';

  const user = await getAdminUser();
  if (!user.isAuthenticated || !canAccessSite(user, siteId)) {
    return <p className="text-sm text-red-600">このサイトの記事にアクセスする権限がありません。</p>;
  }

  const db = getDocClient();
  const [siteResult, ctResult] = await Promise.all([
    db.send(new GetCommand({ TableName: Tables.sites, Key: { siteId } })),
    contentTypeId
      ? db.send(new GetCommand({ TableName: Tables.contentTypes, Key: { siteId, ctId: contentTypeId } }))
      : Promise.resolve({ Item: null }),
  ]);

  if (!siteResult.Item) {
    return <p className="text-sm text-red-600">サイトが見つかりません。</p>;
  }

  const site = siteResult.Item as SiteRecord;
  const contentType = (ctResult.Item ?? null) as ContentTypeRecord | null;
  const contentTypeName = contentType?.name ?? 'コンテンツタイプ';

  if (!contentTypeId) {
    return (
      <div className="admin-card">
        <p className="text-sm text-gray-600">記事作成にはコンテンツタイプ選択が必要です。</p>
        <Link href={`/admin/sites/${siteId}/items`} className="admin-btn admin-btn--primary mt-3">
          記事一覧へ戻る
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <nav className="text-sm text-gray-500 mb-1">
          <Link href={`/admin?siteId=${siteId}`} className="text-gray-700 hover:underline">
            {site.name}
          </Link>{' / '}
          <Link
            href={`/admin/sites/${siteId}/items?contentTypeId=${contentTypeId}`}
            className="text-gray-700 hover:underline"
          >
            {contentTypeName}の記事一覧
          </Link>{' / '}
          <span className="text-gray-900">{contentTypeName}の記事追加</span>
        </nav>
        <h1 className="text-2xl font-bold text-gray-900">{contentTypeName}の記事追加</h1>
      </div>
      <ItemForm siteId={siteId} fixedContentTypeId={contentTypeId} />
    </div>
  );
}
