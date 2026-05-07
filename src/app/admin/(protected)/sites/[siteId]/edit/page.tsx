'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { SiteRecord } from '@/app/api/admin/sites/route';

export default function EditSitePage({ params }: { params: Promise<{ siteId: string }> }) {
  const router = useRouter();
  const [siteId, setSiteId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [plan, setPlan] = useState('free');
  const [status, setStatus] = useState<'active' | 'suspended'>('active');
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    params.then(({ siteId: id }) => {
      setSiteId(id);
      // サイト情報取得
      fetch(`/api/admin/sites/${id}`, { cache: 'no-store' })
        .then((res) => res.json())
        .then((data: { site?: SiteRecord; error?: string }) => {
          if (data.site) {
            setName(data.site.name);
            setDescription(data.site.description ?? '');
            setPlan(data.site.plan);
            setStatus(data.site.status);
          }
          setFetching(false);
        })
        .catch(() => setFetching(false));
    });

    // ロール確認
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
        body: JSON.stringify({ name, description, plan, status }),
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
            説明
          </label>
          <textarea
            maxLength={500}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="admin-input w-full"
            rows={3}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            プラン
          </label>
          <select
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
            className="admin-input w-full"
          >
            <option value="free">Free</option>
            <option value="pro">Pro</option>
            <option value="enterprise">Enterprise</option>
          </select>
        </div>

        {isAdmin && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              ステータス
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as 'active' | 'suspended')}
              className="admin-input w-full"
            >
              <option value="active">有効</option>
              <option value="suspended">停止</option>
            </select>
          </div>
        )}

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
