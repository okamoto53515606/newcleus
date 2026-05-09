/**
 * 管理画面共通レイアウト（外枠）
 * 
 * @description
 * /admin 以下の全ページに適用。メタデータと CSS のみ。
 * 認証チェックは (protected)/layout.tsx で実施。
 * /admin/login はここだけ通る（認証不要）。
 */
import type { Metadata } from 'next';
import './admin.css';

export const metadata: Metadata = {
  title: 'newcleus管理画面',
  description: '管理画面',
  robots: {
    index: false,
    follow: false,
  },
};

export default function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <>{children}</>;
}
