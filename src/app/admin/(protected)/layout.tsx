/**
 * 管理画面認証済みレイアウト
 * 
 * @description
 * Cognito 管理者認証を要求するレイアウト。
 * 未認証の場合は /admin/login にリダイレクト。
 * サイドナビゲーションメニューを表示。
 */
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getAdminUser } from '@/lib/admin-auth';
import { AdminSidebar } from '@/components/admin/admin-sidebar';
import { AdminTopbar } from '@/components/admin/admin-topbar';

// package.json からバージョンを取得（サーバーサイドでのみ実行される）
// why: Client Component へ渡す最小データに留めるためサーバー側で解決する
import { version as APP_VERSION } from '../../../../package.json';

export default async function AdminProtectedLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const adminUser = await getAdminUser();
  if (!adminUser.isAuthenticated) {
    redirect('/admin/login');
  }

  return (
    <div className="admin-layout">
      <AdminSidebar
        email={adminUser.email}
        role={adminUser.role}
        version={APP_VERSION}
      />
      {/* admin-content: トップバー + メインコンテンツを縦に並べるラッパー */}
      <div className="admin-content">
        {/* useSearchParams を使うため Suspense でラップが必要 */}
        <Suspense fallback={<div className="admin-topbar" />}>
          <AdminTopbar />
        </Suspense>
        <main className="admin-main">
          {children}
        </main>
      </div>
    </div>
  );
}
