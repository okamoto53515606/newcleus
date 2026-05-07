import type { Metadata } from "next";
import { Sidebar } from "@/components/sidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: "newcleus セットアップ",
  description: "AWS インフラの初期構築と管理者ユーザー作成",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className="min-h-screen bg-gray-50">
        <header className="bg-white border-b px-6 py-4">
          <h1 className="text-xl font-bold text-gray-800">
            newcleus セットアップ
          </h1>
        </header>
        <div className="flex">
          <Sidebar />
          <main className="flex-1 max-w-2xl py-8 px-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
