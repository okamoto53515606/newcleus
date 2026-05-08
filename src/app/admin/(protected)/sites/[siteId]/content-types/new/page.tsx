'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { use } from 'react';
import type { FieldDefinition } from '@/app/api/admin/sites/[siteId]/content-types/route';
import { FieldEditor } from '../components/field-editor';

const FIELD_TYPES: { value: FieldDefinition['type']; label: string }[] = [
  { value: 'text', label: 'テキスト' },
  { value: 'file', label: 'ファイル/画像' },
  { value: 'flag', label: 'フラグ (真偽値)' },
  { value: 'date', label: '日付' },
  { value: 'num', label: '数値' },
];

export { FIELD_TYPES };

export default function NewContentTypePage({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = use(params);
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/sites/${siteId}/content-types`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, fields }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? '作成に失敗しました');
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

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">新規コンテンツタイプ</h1>
        <p className="text-sm text-gray-500 mt-1">フィールドを定義してコンテンツタイプを作成します</p>
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
              placeholder="例: ブログ記事"
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
            {loading ? '作成中...' : '作成する'}
          </button>
          <button type="button" onClick={() => router.back()} className="admin-btn">
            キャンセル
          </button>
        </div>
      </form>
    </div>
  );
}
