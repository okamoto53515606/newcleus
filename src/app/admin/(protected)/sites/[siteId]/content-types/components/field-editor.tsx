'use client';

/**
 * FieldEditor — コンテンツタイプのフィールド定義を追加・編集・削除するコンポーネント
 *
 * why: CT の new/edit 両ページで同じ UI が必要なため共通化。
 *      フィールド順の入れ替えもできるようにする（将来対応を意識した構造）。
 */

import { useId } from 'react';
import type { FieldDefinition } from '@/app/api/admin/sites/[siteId]/content-types/route';
import { randomBytes } from 'crypto';

const FIELD_TYPES: { value: FieldDefinition['type']; label: string }[] = [
  { value: 'text', label: 'テキスト' },
  { value: 'file', label: 'ファイル/画像' },
  { value: 'flag', label: 'フラグ (真偽値)' },
  { value: 'date', label: '日付' },
  { value: 'num', label: '数値' },
];

interface Props {
  fields: FieldDefinition[];
  onChange: (fields: FieldDefinition[]) => void;
}

export function FieldEditor({ fields, onChange }: Props) {
  const baseId = useId();

  const addField = () => {
    onChange([
      ...fields,
      {
        fieldId: Math.random().toString(36).slice(2, 10),
        name: '',
        type: 'text',
      },
    ]);
  };

  const removeField = (idx: number) => {
    onChange(fields.filter((_, i) => i !== idx));
  };

  const updateField = (idx: number, patch: Partial<FieldDefinition>) => {
    onChange(fields.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  };

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium text-gray-700">フィールド定義</h2>

      {fields.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-4 border border-dashed rounded-lg">
          フィールドがありません。下の「+ フィールドを追加」から追加してください。
        </p>
      )}

      {fields.map((field, idx) => (
        <div key={field.fieldId} className="admin-card border border-gray-200 p-4 space-y-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">
                フィールド名 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                maxLength={50}
                value={field.name}
                onChange={(e) => updateField(idx, { name: e.target.value })}
                className="admin-input w-full text-sm"
                placeholder="例: タイトル"
              />
            </div>
            <div className="w-40">
              <label className="block text-xs text-gray-500 mb-1">タイプ</label>
              <select
                value={field.type}
                onChange={(e) =>
                  updateField(idx, { type: e.target.value as FieldDefinition['type'] })
                }
                className="admin-input w-full text-sm"
              >
                {FIELD_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end pb-1">
              <button
                type="button"
                onClick={() => removeField(idx)}
                className="text-red-500 hover:text-red-700 text-xs"
              >
                削除
              </button>
            </div>
          </div>


        </div>
      ))}

      <button type="button" onClick={addField} className="admin-btn admin-btn--sm w-full">
        + フィールドを追加
      </button>
    </div>
  );
}
