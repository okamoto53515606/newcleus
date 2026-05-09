/**
 * 管理画面トップバー（Client Component）
 *
 * @description
 * 画面上部に常時表示するヘッダーバー。
 * サイト切替プルダウンを右端に配置し、選択時は記事管理トップ（/admin?siteId=...）へ遷移する。
 *
 * why: サイドバーにサイトリストを置くと、サイト数が増えるにつれてナビが縦に長くなり
 *      主要メニュー（記事管理・設定）が埋もれる。トップバーに移すことでサイドバーを
 *      常にコンパクトに保てる。
 *
 * 【非表示ルール】
 * - /admin/sites (サイト一覧): サイト横断ページなので切替UI不要
 * - /admin/tenants (テナント管理): 同上
 */
'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';

interface SiteSummary {
  siteId: string;
  name: string;
}

export function AdminTopbar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [sites, setSites] = useState<SiteSummary[]>([]);

  // サイト切替UIが不要なページ（テナント管理・サイト設定一覧）
  const hideSiteSwitch =
    pathname === '/admin/sites' ||
    pathname === '/admin/sites/new' ||
    /^\/admin\/sites\/[^/]+\/edit$/.test(pathname) ||
    pathname.startsWith('/admin/tenants');

  // URLパスまたはクエリパラメータからアクティブなサイトIDを取得
  // why: /admin/sites/{siteId}/... のパス形式と /admin?siteId=... のクエリ形式の両方を考慮
  const siteIdFromPath = (() => {
    const m = pathname.match(/^\/admin\/sites\/([^/]+)/);
    if (!m || m[1] === 'new') return null;
    return m[1];
  })();
  const activeSiteId = siteIdFromPath ?? searchParams.get('siteId') ?? '';

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/sites', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { sites?: SiteSummary[] }) => {
        if (!cancelled) setSites(d.sites ?? []);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return (
    <header className="admin-topbar">
      {!hideSiteSwitch && (
        <div className="admin-topbar__site-switcher">
          <label className="admin-topbar__label" htmlFor="site-switcher">
            サイト
          </label>
          <select
            id="site-switcher"
            className="admin-topbar__select"
            value={activeSiteId}
            onChange={(e) => {
              if (e.target.value) router.push(`/admin?siteId=${e.target.value}`);
            }}
          >
            {!activeSiteId && <option value="">─ サイトを選択 ─</option>}
            {sites.map((s) => (
              <option key={s.siteId} value={s.siteId}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </header>
  );
}
