/**
 * テナント管理 — ユーザー一覧ページ（admin 専用）
 *
 * Cognito から siteadmin ユーザー一覧を取得し、紐づきサイト名を付与して表示。
 * admin ロール以外はアクセス不可（redirect）。
 */

import { redirect } from 'next/navigation';
import { getAdminUser } from '@/lib/admin-auth';
import { getDocClient, Tables } from '@/lib/dynamodb';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import Link from 'next/link';
import type { SiteRecord } from '@/app/api/admin/sites/route';

export const dynamic = 'force-dynamic';

interface TenantUser {
  userId: string;
  email: string;
  status: string;
  siteIds: string[];
  createdAt: string;
}

export default async function TenantsPage() {
  const user = await getAdminUser();
  if (!user?.isAuthenticated) redirect('/admin/login');
  // why: テナント管理は admin 専用。siteadmin は自分のサイトのコンテンツのみ管理可能。
  if (user.role !== 'admin') redirect('/admin');

  const userPoolId = process.env.COGNITO_USER_POOL_ID!;
  const region = userPoolId.split('_')[0];
  const cognitoClient = new CognitoIdentityProviderClient({ region });

  // why: Cognito ListUsers は custom:* 属性の Filter に対応していないため、
  //      全ユーザー取得後にアプリ側で role=siteadmin のみ絞り込む。
  const usersResp = await cognitoClient.send(
    new ListUsersCommand({
      UserPoolId: userPoolId,
      Limit: 60,
    }),
  );

  const tenants: TenantUser[] = (usersResp.Users ?? [])
    .filter((u) => (u.Attributes ?? []).find((a) => a.Name === 'custom:role')?.Value === 'siteadmin')
    .map((u) => {
    const attrs = Object.fromEntries(
      (u.Attributes ?? []).map((a) => [a.Name, a.Value]),
    );
    let siteIds: string[] = [];
    try { siteIds = JSON.parse(attrs['custom:siteIds'] ?? '[]') as string[]; } catch { /* empty */ }
    return {
      userId: u.Username ?? '',
      email: attrs['email'] ?? u.Username ?? '',
      status: u.UserStatus ?? '',
      siteIds,
      createdAt: u.UserCreateDate?.toISOString() ?? '',
    };
  });

  // サイト名解決用に全サイトを取得
  const db = getDocClient();
  const sitesResult = await db.send(new ScanCommand({ TableName: Tables.sites }));
  const sitesMap = Object.fromEntries(
    (sitesResult.Items ?? []).map((s) => [(s as SiteRecord).siteId, (s as SiteRecord).name]),
  );

  const statusLabel = (s: string) => {
    if (s === 'FORCE_CHANGE_PASSWORD') return { text: '初回ログイン待ち', cls: 'bg-yellow-100 text-yellow-700' };
    if (s === 'CONFIRMED') return { text: '有効', cls: 'bg-green-100 text-green-700' };
    return { text: s, cls: 'bg-gray-100 text-gray-600' };
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">テナント管理</h1>
          <p className="text-sm text-gray-500 mt-1">siteadmin ユーザーとサイト紐づけを管理します</p>
        </div>
        <Link href="/admin/tenants/new" className="admin-btn admin-btn--primary">
          + ユーザー追加
        </Link>
      </div>

      {tenants.length === 0 ? (
        <div className="admin-card text-center py-12">
          <p className="text-gray-500 mb-4">siteadmin ユーザーがまだいません</p>
          <Link href="/admin/tenants/new" className="admin-btn admin-btn--primary">
            最初のユーザーを追加する
          </Link>
        </div>
      ) : (
        <div className="admin-card overflow-hidden p-0">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  メールアドレス
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  ステータス
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  アクセス許可サイト
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  作成日
                </th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {tenants.map((tenant) => {
                const { text, cls } = statusLabel(tenant.status);
                return (
                  <tr key={tenant.userId} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">
                      {tenant.email}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
                        {text}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {tenant.siteIds.length === 0 ? (
                        <span className="text-gray-400">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {tenant.siteIds.map((id) => (
                            <span
                              key={id}
                              className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-700"
                            >
                              {sitesMap[id] ?? id}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {tenant.createdAt ? new Date(tenant.createdAt).toLocaleDateString('ja-JP') : '—'}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link
                        href={`/admin/tenants/${encodeURIComponent(tenant.userId)}/edit`}
                        className="admin-btn text-xs"
                      >
                        編集
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
