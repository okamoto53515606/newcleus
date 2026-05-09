/**
 * テナント管理 — サイト紐づけ編集ページ（admin 専用）
 *
 * [userId] は URL エンコードされた Cognito Username（メールアドレス）
 */

import { redirect, notFound } from 'next/navigation';
import { getAdminUser } from '@/lib/admin-auth';
import { getDocClient, Tables } from '@/lib/dynamodb';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { TenantForm } from '../../components/tenant-form';
import type { SiteRecord } from '@/app/api/admin/sites/route';

export const dynamic = 'force-dynamic';

export default async function EditTenantPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const user = await getAdminUser();
  if (!user?.isAuthenticated) redirect('/admin/login');
  if (user.role !== 'admin') redirect('/admin');

  const { userId } = await params;
  const username = decodeURIComponent(userId);

  const userPoolId = process.env.COGNITO_USER_POOL_ID!;
  const region = userPoolId.split('_')[0];
  const cognitoClient = new CognitoIdentityProviderClient({ region });

  let email = username;
  let initialSiteIds: string[] = [];

  try {
    const resp = await cognitoClient.send(
      new AdminGetUserCommand({ UserPoolId: userPoolId, Username: username }),
    );
    const attrs = Object.fromEntries(
      (resp.UserAttributes ?? []).map((a) => [a.Name, a.Value]),
    );
    email = attrs['email'] ?? username;
    try { initialSiteIds = JSON.parse(attrs['custom:siteIds'] ?? '[]') as string[]; } catch { /* empty */ }
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'UserNotFoundException') notFound();
    throw err;
  }

  const db = getDocClient();
  const result = await db.send(new ScanCommand({ TableName: Tables.sites }));
  const sites = (result.Items ?? []).map((s) => ({
    siteId: (s as SiteRecord).siteId,
    name: (s as SiteRecord).name,
  }));
  sites.sort((a, b) => a.name.localeCompare(b.name, 'ja'));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">ユーザー編集</h1>
        <p className="text-sm text-gray-500 mt-1">サイト紐づけを変更します</p>
      </div>
      <TenantForm
        mode="edit"
        userId={userId}
        initialEmail={email}
        initialSiteIds={initialSiteIds}
        sites={sites}
      />
    </div>
  );
}
