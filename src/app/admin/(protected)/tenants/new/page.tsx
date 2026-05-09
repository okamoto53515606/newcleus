/**
 * テナント管理 — 新規ユーザー追加ページ（admin 専用）
 */

import { redirect } from 'next/navigation';
import { getAdminUser } from '@/lib/admin-auth';
import { getDocClient, Tables } from '@/lib/dynamodb';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { TenantForm } from '../components/tenant-form';
import type { SiteRecord } from '@/app/api/admin/sites/route';

export const dynamic = 'force-dynamic';

export default async function NewTenantPage() {
  const user = await getAdminUser();
  if (!user?.isAuthenticated) redirect('/admin/login');
  if (user.role !== 'admin') redirect('/admin');

  const db = getDocClient();
  const result = await db.send(new ScanCommand({ TableName: Tables.sites }));
  const sites = (result.Items ?? [] as SiteRecord[]).map((s) => ({
    siteId: (s as SiteRecord).siteId,
    name: (s as SiteRecord).name,
  }));
  sites.sort((a, b) => a.name.localeCompare(b.name, 'ja'));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">ユーザー追加</h1>
        <p className="text-sm text-gray-500 mt-1">siteadmin ユーザーを新規作成します</p>
      </div>
      <TenantForm mode="new" sites={sites} />
    </div>
  );
}
