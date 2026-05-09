'use client';

import dynamic from 'next/dynamic';
import imageCompression from 'browser-image-compression';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchWithSigning } from '@/lib/fetch';
import type { ContentTypeRecord, FieldDefinition } from '@/app/api/admin/sites/[siteId]/content-types/route';
import type { ItemRecord, ItemStatus, ItemFieldValue } from '@/app/api/admin/sites/[siteId]/items/route';

const TinyEditor = dynamic(
  () => import('@tinymce/tinymce-react').then((mod) => mod.Editor),
  { ssr: false },
);

const TINYMCE_SCRIPT_SRC = 'https://cdn.jsdelivr.net/npm/tinymce@7/tinymce.min.js';

interface ItemFormProps {
  siteId: string;
  itemId?: string;
  fixedContentTypeId?: string;
}

type FieldMap = Record<string, ItemFieldValue>;

const TITLE_MAX_CHARS = 200;
const BODY_MAX_CHARS = 20_000;
const TEXT_FIELD_MAX_CHARS = 20_000;
const FILE_FIELD_MAX_CHARS = 2_048;
const NUM_MIN = -999_999_999;
const NUM_MAX = 999_999_999;

// why: テンプレートでの参照名を明示することで、embed.js 利用者が
//      Handlebars で {{fields.date0}} のように正確に記述できるようにする
function fieldLabel(field: FieldDefinition): string {
  return `${field.name || field.fieldId} (fields.${field.fieldId})`;
}

function isValidDateValue(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return false;
  return date.toISOString().slice(0, 10) === value;
}

function normalizeLegacyType(raw: unknown): 'text' | 'file' | 'flag' | 'date' | 'num' | null {
  switch (String(raw)) {
    case 'text':
    case 'textarea':
    case 'richtext':
    case 'select':
      return 'text';
    case 'file':
    case 'image':
      return 'file';
    case 'flag':
    case 'boolean':
      return 'flag';
    case 'date':
      return 'date';
    case 'num':
    case 'number':
      return 'num';
    default:
      return null;
  }
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('FileReader result is not a string'));
        return;
      }
      const [, data] = result.split(',', 2);
      if (!data) {
        reject(new Error('Base64 data not found'));
        return;
      }
      resolve(data);
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function normalizeFieldDefs(
  fieldDefs: FieldDefinition[],
  fieldLabels?: Record<string, string>,
): FieldDefinition[] {
  const normalized: FieldDefinition[] = [];
  const used = new Set<string>();

  if (fieldLabels && typeof fieldLabels === 'object') {
    for (const [fieldId, label] of Object.entries(fieldLabels)) {
      if (!/^(text|file|flag|date|num)[0-9]$/.test(fieldId)) continue;
      used.add(fieldId);
      normalized.push({
        fieldId,
        name: String(label ?? '').trim() || fieldId,
        type: fieldId.replace(/[0-9]$/, '') as FieldDefinition['type'],
      });
    }
  }

  const counter: Record<FieldDefinition['type'], number> = {
    text: 0,
    file: 0,
    flag: 0,
    date: 0,
    num: 0,
  };

  for (const field of fieldDefs as Array<FieldDefinition & { type?: string }>) {
    const type = normalizeLegacyType(field.type);
    if (!type) continue;

    let fieldId = String(field.fieldId ?? '').trim();
    if (!/^(text|file|flag|date|num)[0-9]$/.test(fieldId)) {
      do {
        fieldId = `${type}${counter[type]++}`;
      } while (used.has(fieldId));
    }

    if (used.has(fieldId)) continue;
    used.add(fieldId);

    normalized.push({
      fieldId,
      name: String(field.name ?? '').trim() || fieldId,
      type,
    });
  }

  return normalized.sort((a, b) => a.fieldId.localeCompare(b.fieldId));
}

export function ItemForm({ siteId, itemId, fixedContentTypeId }: ItemFormProps) {
  const router = useRouter();
  const isEdit = Boolean(itemId);

  const [contentTypes, setContentTypes] = useState<ContentTypeRecord[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [contentTypeId, setContentTypeId] = useState('');
  const [status, setStatus] = useState<ItemStatus>('draft');
  const [fields, setFields] = useState<FieldMap>({});

  const [fetching, setFetching] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [uploadingFieldId, setUploadingFieldId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setFetching(true);
      setError('');

      try {
        const ctRes = await fetch(`/api/admin/sites/${siteId}/content-types`, {
          cache: 'no-store',
        });
        const ctData = (await ctRes.json()) as { contentTypes?: ContentTypeRecord[]; error?: string };
        if (!ctRes.ok) {
          throw new Error(ctData.error ?? 'コンテンツタイプの取得に失敗しました');
        }

        const cts = ctData.contentTypes ?? [];
        if (cancelled) return;
        setContentTypes(cts);

        if (isEdit && itemId) {
          const itemRes = await fetch(`/api/admin/sites/${siteId}/items/${itemId}`, {
            cache: 'no-store',
          });
          const itemData = (await itemRes.json()) as { item?: ItemRecord; error?: string };
          if (!itemRes.ok || !itemData.item) {
            throw new Error(itemData.error ?? '記事の取得に失敗しました');
          }

          if (cancelled) return;
          setTitle(itemData.item.title);
          setBody(itemData.item.body);
          setContentTypeId(itemData.item.contentTypeId);
          setStatus(itemData.item.status);
          setFields(itemData.item.fields ?? {});
        } else if (cts.length > 0) {
          const preferredCtId =
            (fixedContentTypeId && cts.some((ct) => ct.ctId === fixedContentTypeId) && fixedContentTypeId) ||
            cts[0].ctId;
          setContentTypeId(preferredCtId);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '読み込みに失敗しました');
        }
      } finally {
        if (!cancelled) {
          setFetching(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [siteId, itemId, isEdit, fixedContentTypeId]);

  useEffect(() => {
    if (!fixedContentTypeId) return;
    if (!contentTypes.some((ct) => ct.ctId === fixedContentTypeId)) return;
    setContentTypeId(fixedContentTypeId);
  }, [fixedContentTypeId, contentTypes]);

  const activeContentType = useMemo(
    () => contentTypes.find((ct) => ct.ctId === contentTypeId),
    [contentTypes, contentTypeId],
  );

  const activeFields = useMemo(
    () =>
      normalizeFieldDefs(
        activeContentType?.fields ?? [],
        (activeContentType as unknown as { fieldLabels?: Record<string, string> })?.fieldLabels,
      ),
    [activeContentType],
  );

  const setFieldValue = (fieldId: string, value: ItemFieldValue) => {
    setFields((prev) => ({ ...prev, [fieldId]: value }));
  };

  const validateBeforeSubmit = (): string | null => {
    if (title.length > TITLE_MAX_CHARS) {
      return `タイトルは最大 ${TITLE_MAX_CHARS} 文字です`;
    }
    if (body.length > BODY_MAX_CHARS) {
      return `本文は最大 ${BODY_MAX_CHARS} 文字です`;
    }
    if (!contentTypeId) {
      return 'コンテンツタイプを選択してください';
    }

    for (const field of activeFields) {
      const value = fields[field.fieldId];

      if (field.type === 'text' && typeof value === 'string' && value.length > TEXT_FIELD_MAX_CHARS) {
        return `${field.name || field.fieldId} は最大 ${TEXT_FIELD_MAX_CHARS} 文字です`;
      }

      if (field.type === 'file' && typeof value === 'string' && value.length > FILE_FIELD_MAX_CHARS) {
        return `${field.name || field.fieldId} のURLは最大 ${FILE_FIELD_MAX_CHARS} 文字です`;
      }

      if (field.type === 'date' && typeof value === 'string' && value.trim() !== '' && !isValidDateValue(value)) {
        return `${fieldLabel(field)} は YYYY-MM-DD 形式で入力してください`;
      }

      if (field.type === 'num') {
        const parsed =
          typeof value === 'number'
            ? value
            : typeof value === 'string' && value.trim() !== ''
              ? Number(value)
              : null;

        if (parsed !== null) {
          if (!Number.isFinite(parsed) || parsed < NUM_MIN || parsed > NUM_MAX) {
            return `${field.name || field.fieldId} は ${NUM_MIN} から ${NUM_MAX} の範囲で入力してください`;
          }
        }
      }
    }

    return null;
  };

  const uploadImage = async (file: File): Promise<string> => {
    const compressed = await imageCompression(file, {
      maxSizeMB: 1,
      maxWidthOrHeight: 1024,
      useWebWorker: true,
    });

    const dataBase64 = await toBase64(compressed);

    const uploadRes = await fetchWithSigning('/api/admin/upload', {
      method: 'POST',
      body: JSON.stringify({
        filename: compressed.name,
        contentType: compressed.type || 'image/jpeg',
        dataBase64,
      }),
    });

    const uploadData = (await uploadRes.json()) as {
      status?: 'success' | 'error';
      message?: string;
      publicUrl?: string;
    };

    if (!uploadRes.ok || uploadData.status !== 'success' || !uploadData.publicUrl) {
      throw new Error(uploadData.message ?? '画像アップロードに失敗しました');
    }

    return uploadData.publicUrl;
  };

  const handleFieldFileChange = async (fieldId: string, file: File | null) => {
    if (!file) return;

    setError('');
    setUploadingFieldId(fieldId);
    try {
      const url = await uploadImage(file);
      setFieldValue(fieldId, url);
    } catch (err) {
      setError(err instanceof Error ? err.message : '画像アップロードに失敗しました');
    } finally {
      setUploadingFieldId(null);
    }
  };

  const handleFieldFileDrop = async (
    fieldId: string,
    event: React.DragEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0] ?? null;
    await handleFieldFileChange(fieldId, file);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    const validationError = validateBeforeSubmit();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    try {
      const endpoint = isEdit
        ? `/api/admin/sites/${siteId}/items/${itemId}`
        : `/api/admin/sites/${siteId}/items`;

      const method = isEdit ? 'PUT' : 'POST';

      const payload = {
        title: title.trim(),
        body,
        contentTypeId,
        status,
        fields,
      };

      const res = await fetchWithSigning(endpoint, {
        method,
        body: JSON.stringify(payload),
      });

      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? '保存に失敗しました');
        return;
      }

      router.push(`/admin/sites/${siteId}/items`);
      router.refresh();
    } catch {
      setError('リクエストに失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!isEdit || !itemId) return;
    if (!confirm('この記事を削除しますか？')) return;

    setSaving(true);
    setError('');
    try {
      const res = await fetchWithSigning(`/api/admin/sites/${siteId}/items/${itemId}`, {
        method: 'DELETE',
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? '削除に失敗しました');
        return;
      }

      router.push(`/admin/sites/${siteId}/items`);
      router.refresh();
    } catch {
      setError('削除に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  if (fetching) {
    return <p className="text-sm text-gray-500">読み込み中...</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="admin-card space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            タイトル（任意）
          </label>
          <input
            type="text"
            maxLength={TITLE_MAX_CHARS}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="admin-input w-full"
          />
          <p className="text-xs text-gray-500 mt-1">{title.length} / {TITLE_MAX_CHARS} 文字</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {!fixedContentTypeId && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                コンテンツタイプ <span className="text-red-500">*</span>
              </label>
              <select
                value={contentTypeId}
                onChange={(event) => setContentTypeId(event.target.value)}
                className="admin-input w-full"
                required
              >
                {contentTypes.length === 0 && <option value="">コンテンツタイプがありません</option>}
                {contentTypes.map((ct) => (
                  <option key={ct.ctId} value={ct.ctId}>
                    {ct.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">公開状態</label>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as ItemStatus)}
              className="admin-input w-full"
            >
              <option value="draft">下書き</option>
              <option value="published">公開</option>
            </select>
          </div>
        </div>
      </div>

      <div className="admin-card">
        <h2 className="text-sm font-medium text-gray-700 mb-2">本文（TinyMCE）</h2>
        <p className="text-xs text-gray-500 mb-2">
          画像はエディタ上にドラッグ&ドロップ、または貼り付けでアップロードできます。
        </p>
        <TinyEditor
          tinymceScriptSrc={TINYMCE_SCRIPT_SRC}
          value={body}
          onEditorChange={setBody}
          init={{
            height: 420,
            menubar: false,
            plugins: 'lists link image code',
            toolbar:
              'undo redo | blocks | bold italic forecolor backcolor | bullist numlist | link image | code',
            block_formats: '段落=p; 見出し2=h2; 見出し3=h3; 見出し4=h4',
            images_file_types: 'jpg,jpeg,png,gif,webp',
            images_upload_handler: async (blobInfo) => {
              const file = new File([blobInfo.blob()], blobInfo.filename(), {
                type: blobInfo.blob().type,
              });
              return uploadImage(file);
            },
            automatic_uploads: true,
            convert_urls: false,
          }}
        />
        <p className="text-xs text-gray-500 mt-2">本文: {body.length} / {BODY_MAX_CHARS} 文字</p>
      </div>

      <div className="admin-card space-y-4">
        <h2 className="text-sm font-medium text-gray-700">汎用フィールド</h2>

        {activeFields.length === 0 ? (
          <p className="text-sm text-gray-500">
            このコンテンツタイプには利用可能なフィールド定義がありません。まずコンテンツタイプ設定で
            fieldId（text0 など）を設定してください。
          </p>
        ) : (
          <div className="space-y-4">
            {activeFields.map((field) => {
              const value = fields[field.fieldId];

              if (field.type === 'flag') {
                return (
                  <label key={field.fieldId} className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={Boolean(value)}
                      onChange={(event) => setFieldValue(field.fieldId, event.target.checked)}
                    />
                    {fieldLabel(field)}
                  </label>
                );
              }

              if (field.type === 'file') {
                const previewUrl = typeof value === 'string' ? value.trim() : '';
                return (
                  <div key={field.fieldId}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {fieldLabel(field)}
                    </label>
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={typeof value === 'string' ? value : ''}
                        onChange={(event) => setFieldValue(field.fieldId, event.target.value)}
                        className="admin-input w-full"
                        placeholder="https://..."
                        maxLength={FILE_FIELD_MAX_CHARS}
                      />
                      <label className="block">
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(event) => {
                            void handleFieldFileChange(field.fieldId, event.target.files?.[0] ?? null);
                          }}
                        />
                        <div
                          className="border border-dashed border-gray-300 rounded-lg px-3 py-4 text-center text-sm text-gray-600 hover:bg-gray-50 cursor-pointer"
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => {
                            void handleFieldFileDrop(field.fieldId, event);
                          }}
                        >
                          画像をドラッグ＆ドロップ、またはクリックして選択
                        </div>
                      </label>
                      {uploadingFieldId === field.fieldId && (
                        <p className="text-xs text-gray-500">画像をアップロード中...</p>
                      )}
                      {previewUrl && (
                        <a
                          href={previewUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex flex-col gap-1"
                        >
                          <img
                            src={previewUrl}
                            alt={`${field.name || field.fieldId} preview`}
                            className="w-20 h-20 object-cover rounded border border-gray-200"
                          />
                          <span className="text-xs text-blue-600 hover:underline">画像を拡大表示</span>
                        </a>
                      )}
                      <p className="text-xs text-gray-500">
                        URL: {typeof value === 'string' ? value.length : 0} / {FILE_FIELD_MAX_CHARS} 文字
                      </p>
                    </div>
                  </div>
                );
              }

              if (field.type === 'date') {
                return (
                  <div key={field.fieldId}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {fieldLabel(field)}
                    </label>
                    <input
                      type="date"
                      value={typeof value === 'string' ? value.slice(0, 10) : ''}
                      onChange={(event) => setFieldValue(field.fieldId, event.target.value)}
                      className="admin-input w-full"
                    />
                  </div>
                );
              }

              if (field.type === 'num') {
                return (
                  <div key={field.fieldId}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {fieldLabel(field)}
                    </label>
                    <input
                      type="number"
                      value={typeof value === 'number' ? value : typeof value === 'string' ? value : ''}
                      min={NUM_MIN}
                      max={NUM_MAX}
                      onChange={(event) => {
                        const next = event.target.value;
                        setFieldValue(field.fieldId, next === '' ? '' : Number(next));
                      }}
                      className="admin-input w-full"
                    />
                    <p className="text-xs text-gray-500 mt-1">下限: {NUM_MIN} / 上限: {NUM_MAX}</p>
                  </div>
                );
              }

              return (
                <div key={field.fieldId}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {fieldLabel(field)}
                  </label>
                  <textarea
                    value={typeof value === 'string' ? value : ''}
                    onChange={(event) => setFieldValue(field.fieldId, event.target.value)}
                    className="admin-input w-full"
                    rows={3}
                    maxLength={TEXT_FIELD_MAX_CHARS}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    {typeof value === 'string' ? value.length : 0} / {TEXT_FIELD_MAX_CHARS} 文字
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-3">
        <button type="submit" disabled={saving} className="admin-btn admin-btn--primary">
          {saving ? '保存中...' : isEdit ? '更新する' : '作成する'}
        </button>
        <button
          type="button"
          onClick={() => router.push(`/admin/sites/${siteId}/items`)}
          className="admin-btn"
          disabled={saving}
        >
          キャンセル
        </button>
        {isEdit && (
          <button
            type="button"
            onClick={handleDelete}
            className="admin-btn ml-auto text-red-600 border-red-300 hover:bg-red-50"
            disabled={saving}
          >
            削除
          </button>
        )}
      </div>
    </form>
  );
}
