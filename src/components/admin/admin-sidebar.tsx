/**
 * 管理画面サイドバー（Client Component）
 *
 * @description
 * 開閉可能なサイドナビゲーション。
 * 閉じた状態ではアイコンのみ表示し、開いた状態ではラベルも表示。
 * 開閉状態はlocalStorageに保存され、リロード後も維持されます。
 *
 * 【Props】
 * - email: ログイン中ユーザーのメールアドレス（サーバー側で解決済み）
 * - role: Cognito custom:role（'admin' | 'siteadmin'）
 * - version: package.json のバージョン文字列
 *
 * 【メニュー構成】
 * 1. 開閉ボタン
 * 2. ログイン中メール + ログアウト
 * 3. テナント管理（admin のみ）
 * 4. 記事管理（/admin）
 * 5. 設定（/admin/sites）
 * 6. フッター（バージョン）
 *
 * 【サイト切替】サイドバーではなくトップバー（AdminTopbar）に移動済み
 */
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  FileText,
  Settings,
  ChevronLeft,
  ChevronRight,
  Users,
  LogOut,
} from 'lucide-react';
import { fetchWithSigning } from '@/lib/fetch';

const STORAGE_KEY = 'admin-sidebar-collapsed';

interface AdminSidebarProps {
  email?: string;
  role?: string;
  version?: string;
}

export function AdminSidebar({ email, role, version }: AdminSidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const activeSiteIdFromPath = pathname.match(/^\/admin\/sites\/([^/]+)/)?.[1] ?? null;
  const activeSiteIdFromQuery = searchParams.get('siteId');
  const activeSiteId = activeSiteIdFromPath ?? activeSiteIdFromQuery ?? '';

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null) {
      setIsCollapsed(saved === 'true');
    }
    setIsHydrated(true);
  }, []);

  const toggleCollapsed = () => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    localStorage.setItem(STORAGE_KEY, String(newState));
  };

  const isArticlesActive =
    pathname === '/admin' || /^\/admin\/sites\/[^/]+\/items/.test(pathname);
  const isSettingsActive =
    pathname === '/admin/sites' ||
    pathname === '/admin/sites/new' ||
    /^\/admin\/sites\/[^/]+\/edit$/.test(pathname) ||
    /^\/admin\/sites\/[^/]+\/content-types(?:\/.*)?$/.test(pathname);
  const isTenantsActive = pathname.startsWith('/admin/tenants');

  // 記事管理リンク: アクティブなサイトがあればそのサイトのダッシュボードへ
  const articlesHref = activeSiteId ? `/admin?siteId=${activeSiteId}` : '/admin';

  // why: ネイティブ form POST ではなく fetchWithSigning を使う。
  //      CloudFront OAC は POST ボディの SHA256 を SigV4 で検証するため、
  //      ブラウザの form submit（x-amz-content-sha256 なし）では署名不一致になる。
  //      fetchWithSigning でハッシュを付与し、サーバーから logoutUrl を受け取って遷移する。
  const handleLogout = async () => {
    try {
      const res = await fetchWithSigning('/api/admin/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json() as { logoutUrl?: string };
      window.location.href = data.logoutUrl ?? '/admin/login';
    } catch {
      window.location.href = '/admin/login';
    }
  };


  const collapsed = isHydrated ? isCollapsed : false;

  return (
    <aside className={`admin-sidebar ${collapsed ? 'admin-sidebar--collapsed' : ''}`}>
      {/* 開閉トグルボタン */}
      <div className="admin-sidebar__header">
        <button
          onClick={toggleCollapsed}
          className="admin-sidebar__toggle"
          aria-label={collapsed ? 'メニューを開く' : 'メニューを閉じる'}
          title={collapsed ? 'メニューを開く' : 'メニューを閉じる'}
        >
          {collapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
        </button>
      </div>

      {/* ユーザー情報 & ログアウト（上部に配置） */}
      <div className="admin-sidebar__user-area">
        {!collapsed && email && (
          <p className="admin-sidebar__email" title={email}>{email}</p>
        )}
        <button
          type="button"
          onClick={() => { void handleLogout(); }}
          className="admin-sidebar__logout"
          title="ログアウト"
        >
          <LogOut size={16} />
          {!collapsed && <span>ログアウト</span>}
        </button>
      </div>

      <nav className="admin-nav">
        <ul>
          {/* テナント管理（admin のみ表示） */}
          {role === 'admin' && (
            <li>
              <Link
                href="/admin/tenants"
                className={`admin-nav__link ${isTenantsActive ? 'admin-nav__link--active' : ''}`}
                title={collapsed ? 'テナント管理' : undefined}
              >
                <Users size={20} />
                {!collapsed && <span>テナント管理</span>}
              </Link>
            </li>
          )}
          <li>
            <Link
              href={articlesHref}
              className={`admin-nav__link ${isArticlesActive ? 'admin-nav__link--active' : ''}`}
              title={collapsed ? '記事管理' : undefined}
            >
              <FileText size={20} />
              {!collapsed && <span>記事管理</span>}
            </Link>
          </li>
          <li>
            <Link
              href="/admin/sites"
              className={`admin-nav__link ${isSettingsActive ? 'admin-nav__link--active' : ''}`}
              title={collapsed ? '設定' : undefined}
            >
              <Settings size={20} />
              {!collapsed && <span>設定</span>}
            </Link>
          </li>
        </ul>
      </nav>

      {/* フッター */}
      {!collapsed && (
        <div className="admin-sidebar__footer">
          newcleus {version ? `v${version}` : ''}
        </div>
      )}
    </aside>
  );
}
