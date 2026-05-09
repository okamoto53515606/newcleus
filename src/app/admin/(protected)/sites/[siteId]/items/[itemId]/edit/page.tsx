import { GetCommand } from '@aws-sdk/lib-dynamodb';
import Link from 'next/link';
import { getAdminUser } from '@/lib/admin-auth';
import { getDocClient, Tables } from '@/lib/dynamodb';
import type { SiteRecord } from '@/app/api/admin/sites/route';
import type { ContentTypeRecord } from '@/app/api/admin/sites/[siteId]/content-types/route';
import type { ItemRecord } from '@/app/api/admin/sites/[siteId]/items/route';
import { ItemForm } from '../../components/item-form';

export const dynamic = 'force-dynamic';

function canAccessSite(user: { role?: string; siteIds?: string[] }, siteId: string): boolean {
  if (user.role === 'admin') return true;
  if (user.role === 'siteadmin') return user.siteIds?.includes(siteId) ?? false;
  return false;
}

export default async function EditItemPage({
  params,
}: {
  params: Promise<{ siteId: string; itemId: string }>;
}) {
  const { siteId, itemId } = await params;

  const user = await getAdminUser();
  if (!user.isAuthenticated || !canAccessSite(user, siteId)) {
    return <p className="text-sm text-red-600">このサイトの記事にアクセスする権限がありません。</p>;
  }

  const db = getDocClient();
  const [siteResult, itemResult] = await Promise.all([
    db.send(new GetCommand({ TableName: Tables.sites, Key: { siteId } })),
    db.send(new GetCommand({ TableName: Tables.items, Key: { siteId, itemId } })),
  ]);

  if (!siteResult.Item) {
    return <p className="text-sm text-red-600">サイトが見つかりません。</p>;
  }
  if (!itemResult.Item) {
    return <p className="text-sm text-red-600">記事が見つかりません。</p>;
  }

  const site = siteResult.Item as SiteRecord;
  const item = itemResult.Item as ItemRecord;
  const ctResult = await db.send(
    new GetCommand({ TableName: Tables.contentTypes, Key: { siteId, ctId: item.contentTypeId } }),
  );
  const contentType = (ctResult.Item ?? null) as ContentTypeRecord | null;
  const contentTypeName = contentType?.name ?? 'コンテンツタイプ';

  return (
    <div className="space-y-6">
      <div>
        <nav className="text-sm text-gray-500 mb-1">
          <Link href={`/admin?siteId=${siteId}`} className="text-gray-700 hover:underline">
            {site.name}
          </Link>{' '}
          &gt;{' '}
          <Link
            href={`/admin/sites/${siteId}/items?contentTypeId=${item.contentTypeId}`}
            className="text-gray-700 hover:underline"
          >
            {contentTypeName}
          </Link>{' '}
          &gt;{' '}
          <span className="text-gray-700">記事編集</span>
        </nav>
        <h1 className="text-2xl font-bold text-gray-900">{contentTypeName}の記事編集</h1>
      </div>
      <ItemForm siteId={siteId} itemId={itemId} fixedContentTypeId={item.contentTypeId} />
    </div>
  );
}
