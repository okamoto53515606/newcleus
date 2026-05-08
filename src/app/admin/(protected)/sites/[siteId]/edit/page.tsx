'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { SiteRecord } from '@/app/api/admin/sites/route';

export default function EditSitePage({ params }: { params: Promise<{ siteId: string }> }) {
  const router = useRouter();
  const [siteId, setSiteId] = useState('');
  const [name, setName] = useState('');
  const [shortname, setShortname] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    params.then(({ siteId: id }) => {
      setSiteId(id);
      fetch(`/api/admin/sites/${id}`, { cache: 'no-store' })
        .then((res) => res.json())
        .then((data: { site?: SiteRecord; error?: string }) => {
          if (data.site) {
            setName(data.site.name);
            setShortname(data.site.shortname ?? '');
          }
          setFetching(false);
        })
        .catch(() => setFetching(false));
    });

    fetch('/api/admin/auth/me', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data: { role?: string }) => setIsAdmin(data.role === 'admin'))
      .catch(() => {});
  }, [params]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch(`/api/admin/sites/${siteId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, shortname }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? '更新に失敗しました');
        return;
      }
      router.push('/admin/sites');
      router.refresh();
    } catch {
      setError('リクエストに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('このサイトを削除しますか？')) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/sites/${siteId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? '削除に失敗しました');
        return;
      }
      router.push('/admin/sites');
      router.refresh();
    } catch {
      setError('リクエストに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  if (fetching) {
    return <p className="text-gray-500 text-sm">読み込み中...</p>;
  }

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">サイト編集</h1>
        <p className="text-sm text-gray-500 mt-1 font-mono">{siteId}</p>
      </div>

      <form onSubmit={handleSubmit} className="admin-card space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            サイト名 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="admin-input w-full"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            短縮名（shortname）<span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            required
            maxLength={50}
            value={shortname}
            onChange={(e) => setShortname(e.target.value.toLowerCase())}
            className="admin-input w-full font-mono"
            pattern="[a-z0-9\-]+"
            title="英小文字・数字・ハイフンのみ使用できます"
          />
          <p className="text-xs text-gray-400 mt-1">英小文字・数字・ハイフンのみ。変更すると公開 API の URL が変わります。</p>
        </div>

        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={loading}
            className="admin-btn admin-btn--primary"
          >
            {loading ? '更新中...' : '更新する'}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="admin-btn"
          >
            キャンセル
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={loading}
              className="admin-btn ml-auto text-red-600 border-red-300 hover:bg-red-50"
            >
              削除
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
