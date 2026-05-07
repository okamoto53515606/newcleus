/**
 * 管理画面認証済みレイアウト
 * 
 * @description
 * Cognito 管理者認証を要求するレイアウト。
 * 未認証の場合は /admin/login にリダイレクト。
 * サイドナビゲーションメニューを表示。
 */
import { redirect } from 'next/navigation';
import { getAdminUser } from '@/lib/admin-auth';
import { AdminSidebar } from '@/components/admin/admin-sidebar';

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
      <AdminSidebar />
      <main className="admin-main">
        {children}
      </main>
    </div>
  );
}
