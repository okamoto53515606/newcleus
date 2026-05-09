'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { use } from 'react';
import Link from 'next/link';
import type { ContentTypeRecord, FieldDefinition } from '@/app/api/admin/sites/[siteId]/content-types/route';
import { FieldEditor } from '../../components/field-editor';

export default function EditContentTypePage({
  params,
}: {
  params: Promise<{ siteId: string; ctId: string }>;
}) {
  const { siteId, ctId } = use(params);
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState('');
  const [siteName, setSiteName] = useState('');

  useEffect(() => {
    Promise.all([
      fetch(`/api/admin/sites/${siteId}/content-types/${ctId}`, { cache: 'no-store' }).then((r) => r.json()),
      fetch(`/api/admin/sites/${siteId}`, { cache: 'no-store' }).then((r) => r.json()),
    ])
      .then(([ctData, siteData]: [{ contentType?: ContentTypeRecord }, { site?: { name: string } }]) => {
        if (ctData.contentType) {
          setName(ctData.contentType.name);
          setDescription(ctData.contentType.description ?? '');
          setFields(ctData.contentType.fields);
        }
        setSiteName(siteData.site?.name ?? '');
        setFetching(false);
      })
      .catch(() => setFetching(false));
  }, [siteId, ctId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/sites/${siteId}/content-types/${ctId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, fields }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? '更新に失敗しました');
        return;
      }
      router.push(`/admin/sites/${siteId}/content-types`);
      router.refresh();
    } catch {
      setError('リクエストに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('このコンテンツタイプを削除しますか？')) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/sites/${siteId}/content-types/${ctId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? '削除に失敗しました');
        return;
      }
      router.push(`/admin/sites/${siteId}/content-types`);
      router.refresh();
    } catch {
      setError('リクエストに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  if (fetching) return <p className="text-gray-500 text-sm">読み込み中...</p>;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <nav className="text-sm text-gray-500 mb-1">
          <Link href="/admin/sites" className="hover:underline text-gray-500">設定</Link>
          {' / '}
          <span className="text-gray-700">{siteName || '…'}</span>
          {' / '}
          <Link href={`/admin/sites/${siteId}/content-types`} className="hover:underline text-gray-700">
            コンテンツタイプ一覧
          </Link>
          {' / '}
          <span className="text-gray-900">コンテンツタイプ編集</span>
        </nav>
        <h1 className="text-2xl font-bold text-gray-900">コンテンツタイプ編集</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="admin-card space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              タイプ名 <span className="text-red-500">*</span>
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
            <label className="block text-sm font-medium text-gray-700 mb-1">説明</label>
            <textarea
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="admin-input w-full"
              rows={2}
            />
          </div>
        </div>

        <FieldEditor fields={fields} onChange={setFields} />

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-3">
          <button type="submit" disabled={loading} className="admin-btn admin-btn--primary">
            {loading ? '更新中...' : '更新する'}
          </button>
          <button type="button" onClick={() => router.back()} className="admin-btn">
            キャンセル
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={loading}
            className="admin-btn ml-auto text-red-600 border-red-300 hover:bg-red-50"
          >
            削除
          </button>
        </div>
      </form>
    </div>
  );
}
