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
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Globe,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

const STORAGE_KEY = 'admin-sidebar-collapsed';

const navItems = [
  { href: '/admin', label: 'ダッシュボード', icon: LayoutDashboard },
  { href: '/admin/sites', label: 'サイト管理', icon: Globe },
];

export function AdminSidebar() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const pathname = usePathname();

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

  const isActive = (href: string) => {
    if (href === '/admin') {
      return pathname === '/admin';
    }
    return pathname.startsWith(href);
  };

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
          {navItems.map(({ href, label, icon: Icon }) => (
            <li key={href}>
              <Link
                href={href}
                className={`admin-nav__link ${isActive(href) ? 'admin-nav__link--active' : ''}`}
                title={collapsed ? label : undefined}
              >
                <Icon size={20} />
                {!collapsed && <span>{label}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
