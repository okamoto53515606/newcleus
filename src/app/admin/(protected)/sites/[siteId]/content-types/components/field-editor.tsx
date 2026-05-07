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
  { value: 'textarea', label: 'テキストエリア' },
  { value: 'richtext', label: 'リッチテキスト' },
  { value: 'number', label: '数値' },
  { value: 'boolean', label: 'チェックボックス' },
  { value: 'date', label: '日付' },
  { value: 'image', label: '画像' },
  { value: 'select', label: '選択肢' },
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
        required: false,
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
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-gray-700">フィールド定義</h2>
        <button type="button" onClick={addField} className="admin-btn text-xs">
          + フィールドを追加
        </button>
      </div>

      {fields.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-4 border border-dashed rounded-lg">
          フィールドがありません。「+ フィールドを追加」から追加してください。
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

          <div className="flex items-center gap-2">
            <input
              id={`${baseId}-req-${idx}`}
              type="checkbox"
              checked={field.required ?? false}
              onChange={(e) => updateField(idx, { required: e.target.checked })}
              className="h-4 w-4 text-blue-600 border-gray-300 rounded"
            />
            <label htmlFor={`${baseId}-req-${idx}`} className="text-xs text-gray-600">
              必須項目
            </label>
          </div>

          {field.type === 'select' && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                選択肢（1行1項目）
              </label>
              <textarea
                value={(field.options ?? []).join('\n')}
                onChange={(e) =>
                  updateField(idx, {
                    options: e.target.value
                      .split('\n')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                className="admin-input w-full text-sm"
                rows={3}
                placeholder="選択肢A&#10;選択肢B&#10;選択肢C"
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
