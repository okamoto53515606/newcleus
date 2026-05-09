'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchWithSigning } from '@/lib/fetch';

export default function NewSitePage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetchWithSigning('/api/admin/sites', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? '作成に失敗しました');
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

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">新規サイト作成</h1>
        <p className="text-sm text-gray-500 mt-1">
          新しいテナントサイトを作成します
        </p>
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
            placeholder="例: サンプルクリニック"
          />
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
            {loading ? '作成中...' : '作成する'}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="admin-btn"
          >
            キャンセル
          </button>
        </div>
      </form>
    </div>
  );
}
