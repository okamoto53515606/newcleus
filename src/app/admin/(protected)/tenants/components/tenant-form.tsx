'use client';

/**
 * テナント（siteadmin）追加・編集フォーム
 *
 * 【モード】
 * - mode='new': ユーザー追加（email・初期パスワード・siteIds）
 * - mode='edit': サイト紐づけ変更（siteIds のみ）
 *
 * 【設計方針】
 * - Server Actions 禁止のため fetch + Route Handler 経由で送信
 * - siteIds はチェックボックスで複数選択（ユーザーの回答通り multi-site 対応）
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchWithSigning } from '@/lib/fetch';

interface SiteSummary {
  siteId: string;
  name: string;
}

interface TenantFormProps {
  mode: 'new' | 'edit';
  userId?: string; // edit 時: URL エンコード済み Cognito Username
  initialEmail?: string;
  initialSiteIds?: string[];
  sites: SiteSummary[];
}

export function TenantForm({
  mode,
  userId,
  initialEmail = '',
  initialSiteIds = [],
  sites,
}: TenantFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState(initialEmail);
  const [tempPassword, setTempPassword] = useState('');
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>(initialSiteIds);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const toggleSite = (siteId: string) => {
    setSelectedSiteIds((prev) =>
      prev.includes(siteId) ? prev.filter((id) => id !== siteId) : [...prev, siteId],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);

    try {
      let res: Response;
      if (mode === 'new') {
        res = await fetchWithSigning('/api/admin/tenants', {
          method: 'POST',
          body: JSON.stringify({ email, temporaryPassword: tempPassword, siteIds: selectedSiteIds }),
        });
      } else {
        res = await fetchWithSigning(`/api/admin/tenants/${userId}`, {
          method: 'PUT',
          body: JSON.stringify({ siteIds: selectedSiteIds }),
        });
      }

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? '保存に失敗しました');
        return;
      }

      router.push('/admin/tenants');
      router.refresh();
    } catch {
      setError('リクエストに失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!userId) return;
    if (!confirm(`「${initialEmail}」を削除しますか？この操作は取り消せません。`)) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/tenants/${userId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? '削除に失敗しました');
        return;
      }
      router.push('/admin/tenants');
      router.refresh();
    } catch {
      setError('リクエストに失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="admin-card space-y-5 max-w-lg">
      {/* メールアドレス */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          メールアドレス <span className="text-red-500">*</span>
        </label>
        {mode === 'new' ? (
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="admin-input w-full"
            placeholder="user@example.com"
          />
        ) : (
          <p className="admin-input w-full bg-gray-50 text-gray-700 select-all">{initialEmail}</p>
        )}
      </div>

      {/* 初期パスワード（新規のみ） */}
      {mode === 'new' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            初期パスワード <span className="text-red-500">*</span>
          </label>
          <input
            type="password"
            required
            minLength={8}
            value={tempPassword}
            onChange={(e) => setTempPassword(e.target.value)}
            className="admin-input w-full"
            autoComplete="new-password"
          />
          <p className="text-xs text-gray-400 mt-1">
            8文字以上。ユーザーは初回ログイン時に変更を求められます。
          </p>
        </div>
      )}

      {/* サイト紐づけ */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          アクセス許可サイト
        </label>
        {sites.length === 0 ? (
          <p className="text-sm text-gray-400">サイトが登録されていません。先にサイトを作成してください。</p>
        ) : (
          <div className="space-y-2 border border-gray-200 rounded-md p-3 max-h-52 overflow-y-auto">
            {sites.map((site) => (
              <label key={site.siteId} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedSiteIds.includes(site.siteId)}
                  onChange={() => toggleSite(site.siteId)}
                  className="w-4 h-4 accent-blue-600"
                />
                <span className="text-sm text-gray-800">{site.name}</span>
                <span className="text-xs text-gray-400 font-mono ml-auto">{site.siteId}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-3 pt-1">
        <button
          type="submit"
          disabled={saving}
          className="admin-btn admin-btn--primary"
        >
          {saving ? '保存中...' : mode === 'new' ? 'ユーザーを追加' : '保存する'}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="admin-btn"
        >
          キャンセル
        </button>
        {mode === 'edit' && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={saving}
            className="admin-btn ml-auto text-red-600 border border-red-300 hover:bg-red-50"
          >
            削除
          </button>
        )}
      </div>
    </form>
  );
}
