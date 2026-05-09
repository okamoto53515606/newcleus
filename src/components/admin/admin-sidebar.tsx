/**
 * 管理画面サイドバー（Client Component）
 *
 * @description
 * 開閉可能なサイドナビゲーション。
 * 閉じた状態ではアイコンのみ表示し、開いた状態ではラベルも表示。
 * 開閉状態はlocalStorageに保存され、リロード後も維持されます。
 */
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  LayoutDashboard,
  Settings,
  Globe,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

const STORAGE_KEY = 'admin-sidebar-collapsed';

interface SiteSummary {
  siteId: string;
  name: string;
}

export function AdminSidebar() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [sites, setSites] = useState<SiteSummary[]>([]);
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const activeSiteIdFromPath = pathname.match(/^\/admin\/sites\/([^/]+)/)?.[1] ?? null;
  const activeSiteIdFromQuery = searchParams.get('siteId');

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null) {
      setIsCollapsed(saved === 'true');
    }
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadSites() {
      try {
        const res = await fetch('/api/admin/sites', { cache: 'no-store' });
        const data = (await res.json()) as { sites?: SiteSummary[] };
        if (cancelled) return;
        setSites(data.sites ?? []);
      } catch {
        if (!cancelled) {
          setSites([]);
        }
      }
    }

    void loadSites();

    return () => {
      cancelled = true;
    };
  }, []);

  const toggleCollapsed = () => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    localStorage.setItem(STORAGE_KEY, String(newState));
  };

  const isDashboardActive = pathname === '/admin';
  const isSettingsActive =
    pathname === '/admin/sites' ||
    pathname === '/admin/sites/new' ||
    /^\/admin\/sites\/[^/]+\/edit$/.test(pathname) ||
    /^\/admin\/sites\/[^/]+\/content-types(?:\/.*)?$/.test(pathname);

  const effectiveActiveSiteId =
    activeSiteIdFromQuery ||
    activeSiteIdFromPath ||
    (pathname === '/admin' ? sites[0]?.siteId : undefined);

  const collapsed = isHydrated ? isCollapsed : false;

  return (
    <aside className={`admin-sidebar ${collapsed ? 'admin-sidebar--collapsed' : ''}`}>
      <div className="admin-sidebar__header">
        {!collapsed && <h2>newcleus</h2>}
        <button
          onClick={toggleCollapsed}
          className="admin-sidebar__toggle"
          aria-label={collapsed ? 'メニューを開く' : 'メニューを閉じる'}
          title={collapsed ? 'メニューを開く' : 'メニューを閉じる'}
        >
          {collapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
        </button>
      </div>

      <nav className="admin-nav">
        <ul>
          <li>
            <Link
              href="/admin"
              className={`admin-nav__link ${isDashboardActive ? 'admin-nav__link--active' : ''}`}
              title={collapsed ? 'ダッシュボード' : undefined}
            >
              <LayoutDashboard size={20} />
              {!collapsed && <span>ダッシュボード</span>}
            </Link>
          </li>
        </ul>

        {!collapsed && (
          <>
            <hr className="admin-nav__separator" />
            <p className="text-xs text-gray-500 px-4 mb-2">サイト選択</p>
            <ul>
              {sites.map((site) => {
                const active = effectiveActiveSiteId === site.siteId;
                return (
                  <li key={site.siteId}>
                    <Link
                      href={`/admin?siteId=${site.siteId}`}
                      className={`admin-nav__link ${active ? 'admin-nav__link--active' : ''}`}
                      title={site.name}
                    >
                      <Globe size={16} />
                      <span className="truncate">{site.name}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        <ul>
          <li>
            <Link
              href="/admin/sites"
              className={`admin-nav__link admin-nav__link--back ${isSettingsActive ? 'admin-nav__link--active' : ''}`}
              title={collapsed ? '設定' : undefined}
            >
              <Settings size={20} />
              {!collapsed && <span>設定</span>}
            </Link>
          </li>
        </ul>
      </nav>
    </aside>
  );
}
