/**
 * 管理者ダッシュボード
 *
 * @description
 * newcleus 管理画面のトップページ。
 * サイト管理・コンテンツタイプ管理へのリンクを提供する。
 */
import { Globe, List } from 'lucide-react';
import Link from 'next/link';

export default function AdminDashboardPage() {
  return (
    <>
      <header className="admin-page-header">
        <h1>ダッシュボード</h1>
        <p>newcleus へようこそ。左のメニューからサイトやコンテンツを管理します。</p>
      </header>

      <div className="admin-card">
        <h2>クイックリンク</h2>
        <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', flexWrap: 'wrap' }}>
          <Link href="/admin/sites" className="admin-btn">
            <Globe size={16} /> サイト管理
          </Link>
        </div>
      </div>

      <div className="admin-card" style={{ marginTop: '1.5rem' }}>
        <h2>newcleus とは</h2>
        <p style={{ marginTop: '0.75rem', color: '#6c757d', lineHeight: 1.8 }}>
          newcleus はマルチテナント対応のヘッドレス CMS です。<br />
          サイトごとにコンテンツタイプ（フィールド定義）・テンプレート・アイテムを管理し、
          公開 API 経由でコンテンツを配信します。
        </p>
        <ul style={{ marginTop: '1rem', paddingLeft: '1.25rem', color: '#495057', lineHeight: 2 }}>
          <li><Link href="/admin/sites" style={{ color: '#0d6efd' }}>サイト管理</Link> — サイトの作成・設定</li>
          <li>コンテンツタイプ管理 — フィールド定義の管理（サイト内）</li>
          <li>アイテム管理 — 記事・商品・FAQ などコンテンツの管理（Phase 3 以降）</li>
        </ul>
      </div>
    </>
  );
}
