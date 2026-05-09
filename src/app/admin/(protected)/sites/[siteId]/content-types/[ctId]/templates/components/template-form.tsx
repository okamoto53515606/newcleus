'use client';

/**
 * テンプレートフォームコンポーネント
 * why: テンプレートの新規作成・編集を一本化したクライアントコンポーネント。
 *      Handlebars テンプレート本文はプレーンテキストエリアで編集（TinyMCEは使わない）。
 *      CTのフィールド定義を受け取り、利用可能な変数・日付・ページネーション変数を
 *      インラインリファレンスとして表示することで、テンプレート記述をサポートする。
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchWithSigning } from '@/lib/fetch';
import type { TemplateRecord } from '@/app/api/admin/sites/[siteId]/content-types/[ctId]/templates/route';
import type { FieldDefinition } from '@/app/api/admin/sites/[siteId]/content-types/route';

interface TemplateFormProps {
  siteId: string;
  ctId: string;
  /** 編集時に渡す既存データ。未指定なら新規作成モード */
  initial?: TemplateRecord;
  /** CTのカスタムフィールド定義。変数リファレンスパネルの表示に使用する。 */
  fields?: FieldDefinition[];
}

/** 変数バッジ: コードと説明を横並びで表示するインラインコンポーネント */
function VarBadge({ code, desc }: { code: string; desc: string }) {
  return (
    <span className="inline-flex items-center gap-1 bg-white border border-gray-200 rounded px-2 py-0.5 text-xs">
      <code className="text-blue-700 font-mono whitespace-nowrap">{code}</code>
      <span className="text-gray-300">|</span>
      <span className="text-gray-500 whitespace-nowrap">{desc}</span>
    </span>
  );
}

/** フィールドタイプの出力値説明 */
const FIELD_TYPE_DESC: Record<FieldDefinition['type'], string> = {
  text: 'テキスト',
  file: 'ファイルURL',
  flag: 'true/false',
  date: 'YYYY-MM-DD',
  num: '数値',
};

// ─────────────────────────────────────────────────────────────────────
// スターターテンプレート
// why: 初めてテンプレートを作成するユーザーが迷わないよう、よく使うパターンを
//      選択するだけで本文に自動セットできるようにする。
//      ctId はプレースホルダーとして渡し、呼び出し側で差し替える。
// ─────────────────────────────────────────────────────────────────────
function buildStarters(ctId: string) {
  return [
    {
      key: 'list-modal',
      label: '記事一覧（タイトルクリックでモーダル表示）',
      name: '記事一覧（モーダル）',
      shortname: 'list-modal',
      // why: <script> ブロックは embed.js 側が data-cms-modal 属性を検出して自動初期化するため不要。
      //      data-body="{{{body}}}" はHTML属性にHTMLを埋め込む壊れたパターンのため廃止し、
      //      クリック時に embed.js が /render?itemId=xxx をfetchして modal-body に注入する方式に統一。
      //      CSSクラス名: ct-{ctId} — 同一ページに複数CTが共存しても干渉しないよう ctId でスコープする
      body: `<style>
.ct-${ctId} .nc-item { border-bottom: 1px solid #eee; padding: 8px 0; display: flex; gap: 12px; align-items: baseline; }
.ct-${ctId} .nc-date { color: #888; font-size: .875rem; white-space: nowrap; }
.ct-${ctId} .nc-title { cursor: pointer; color: #0066cc; }
.ct-${ctId} .nc-title:hover { text-decoration: underline; }
.ct-${ctId} .nc-pager { display: flex; gap: 8px; margin-top: 1em; }
.ct-${ctId} .nc-modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.5); z-index: 9999; align-items: center; justify-content: center; }
.ct-${ctId} .nc-modal-overlay.is-open { display: flex; }
.ct-${ctId} .nc-modal { background: #fff; border-radius: 8px; padding: 24px; max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto; position: relative; }
.ct-${ctId} .nc-modal-close { position: absolute; top: 12px; right: 16px; font-size: 1.5rem; cursor: pointer; background: none; border: none; }
</style>

<div class="ct-${ctId}">
  {{#each items}}
  <div class="nc-item">
    <span class="nc-date">{{formatDate createdAt "YYYY/MM/DD"}}</span>
    {{!-- data-cms-modal: embed.js がクリック時に /render?itemId=xxx をfetchしてモーダルに注入する --}}
    <span class="nc-title" data-cms-modal="{{id}}">{{title}}</span>
  </div>
  {{/each}}

  <div class="nc-pager">
    {{#if tools.hasPrev}}<a data-cms-paginate href="{{tools.prevHref}}">前へ</a>{{/if}}
    {{#if tools.hasNext}}<a data-cms-paginate href="{{tools.nextHref}}">次へ</a>{{/if}}
  </div>

  {{!-- embed.js が [data-cms-modal] クリック時にここへ詳細HTMLを注入し、is-open クラスで表示する --}}
  <div class="nc-modal-overlay">
    <div class="nc-modal">
      <button class="nc-modal-close" aria-label="閉じる">&times;</button>
      <div class="nc-modal-body"></div>
    </div>
  </div>
</div>`,
    },
    {
      key: 'list-simple',
      label: '記事一覧（シンプル）',
      name: '記事一覧（シンプル）',
      shortname: 'list-simple',
      body: `<div class="ct-${ctId}">
  {{#each items}}
  <div class="nc-item">
    <span class="nc-date">{{formatDate createdAt "YYYY/MM/DD"}}</span>
    <span class="nc-title">{{title}}</span>
  </div>
  {{/each}}

  <div class="nc-pager">
    {{#if tools.hasPrev}}<a data-cms-paginate href="{{tools.prevHref}}">前へ</a>{{/if}}
    {{#if tools.hasNext}}<a data-cms-paginate href="{{tools.nextHref}}">次へ</a>{{/if}}
  </div>
</div>`,
    },
    {
      key: 'detail-full',
      label: '記事詳細（フルHTMLページ）',
      name: '記事詳細',
      shortname: 'detail',
      body: `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{item.title}}</title>
  <style>
    body { font-family: sans-serif; max-width: 800px; margin: 0 auto; padding: 24px; }
    .nc-date { color: #888; font-size: .875rem; }
    .nc-body img { max-width: 100%; height: auto; }
  </style>
</head>
<body>
  {{#with item}}
  <article>
    <p class="nc-date">{{formatDate createdAt "YYYY/MM/DD"}}</p>
    <h1>{{title}}</h1>
    <div class="nc-body">{{{body}}}</div>
  </article>
  {{/with}}
</body>
</html>`,
    },
  ];
}

export default function TemplateForm({ siteId, ctId, initial, fields }: TemplateFormProps) {
  const router = useRouter();
  const isEdit = !!initial;

  const [name, setName] = useState(initial?.name ?? '');
  const [shortname, setShorname] = useState(initial?.shortname ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // why: 変数リファレンスは初期非表示にして画面を整理する（アコーディオン式）
  const [showVars, setShowVars] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);

  const starters = buildStarters(ctId);

  function applyStarter(key: string) {
    const s = starters.find((x) => x.key === key);
    if (!s) return;
    if (body && !confirm('現在のテンプレート本文が上書きされます。よろしいですか？')) return;
    setName(s.name);
    setShorname(s.shortname);
    setBody(s.body);
  }

  async function handlePreview() {
    if (!body.trim()) return;
    setPreviewing(true);
    try {
      const res = await fetchWithSigning('/api/admin/preview', {
        method: 'POST',
        body: JSON.stringify({ templateBody: body, fields, ctId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { error?: string }).error ?? 'プレビュー生成に失敗しました');
        return;
      }
      setPreviewHtml((data as { html: string }).html);
    } catch {
      setError('通信エラーが発生しました');
    } finally {
      setPreviewing(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!name.trim()) { setError('テンプレート名は必須です'); return; }
    if (!shortname.trim()) { setError('shortname は必須です'); return; }
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(shortname)) {
      setError('shortname は英小文字・数字・ハイフン（先頭は英数字）で入力してください');
      return;
    }

    setSaving(true);
    try {
      const payload = JSON.stringify({ name, shortname, body });

      const res = isEdit
        ? await fetchWithSigning(
            `/api/admin/sites/${siteId}/content-types/${ctId}/templates/${initial!.templateId}`,
            { method: 'PUT', body: payload },
          )
        : await fetchWithSigning(
            `/api/admin/sites/${siteId}/content-types/${ctId}/templates`,
            { method: 'POST', body: payload },
          );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? '保存に失敗しました');
        return;
      }

      router.push(`/admin/sites/${siteId}/content-types/${ctId}/templates`);
      router.refresh();
    } catch {
      setError('通信エラーが発生しました');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!isEdit) return;
    if (!confirm(`テンプレート「${initial!.name}」を削除しますか？`)) return;

    setSaving(true);
    try {
      // why: CloudFront は DELETE body を転送しないのでパスパラメータのみで識別
      const res = await fetchWithSigning(
        `/api/admin/sites/${siteId}/content-types/${ctId}/templates/${initial!.templateId}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? '削除に失敗しました');
        return;
      }
      router.push(`/admin/sites/${siteId}/content-types/${ctId}/templates`);
      router.refresh();
    } catch {
      setError('通信エラーが発生しました');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded">
          {error}
        </div>
      )}

      {/* スターターテンプレート選択 */}
      {!isEdit && (
        <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
          <span className="text-sm font-medium text-blue-800 whitespace-nowrap">スターターを読み込む:</span>
          <select
            defaultValue=""
            onChange={(e) => { applyStarter(e.target.value); e.target.value = ''; }}
            className="admin-input text-sm flex-1"
          >
            <option value="" disabled>-- パターンを選択してください --</option>
            {starters.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </div>
      )}

      {/* テンプレート名 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          テンプレート名 <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="admin-input w-full"
          placeholder="例: お知らせ一覧"
          maxLength={100}
          required
        />
      </div>

      {/* shortname */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          shortname <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={shortname}
          onChange={(e) => setShorname(e.target.value.toLowerCase())}
          className="admin-input w-full"
          placeholder="例: list"
          pattern="[a-z0-9][-a-z0-9]{0,62}"
          required
        />
        <p className="text-xs text-gray-500 mt-1">
          英小文字・数字・ハイフン。embed.js からの呼び出し識別子になります。
        </p>
      </div>


      {/* 利用可能な変数リファレンス */}
      <div>
        <button
          type="button"
          onClick={() => setShowVars(!showVars)}
          className="flex items-center gap-1 text-sm font-medium text-gray-700 mb-2 hover:text-gray-900"
        >
          <span>{showVars ? '▾' : '▸'}</span>
          利用可能な変数リファレンス
        </button>

        {showVars && (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-4 text-xs">

            {/* 固定変数 */}
            <section>
              <p className="font-medium text-gray-600 mb-2">
                固定変数
                <span className="font-normal text-gray-400 ml-1">（{'{{#each items}}'} ブロック内で使用）</span>
              </p>
              <div className="flex flex-wrap gap-1.5">
                <VarBadge code="{{title}}" desc="記事タイトル" />
                <VarBadge code="{{{body}}}" desc="記事本文HTML（エスケープなし出力）" />
                <VarBadge code="{{createdAt}}" desc="作成日時 ISO 8601" />
                <VarBadge code="{{updatedAt}}" desc="更新日時 ISO 8601" />
                <VarBadge code="{{itemId}}" desc="記事ID" />
              </div>
            </section>

            {/* カスタムフィールド */}
            {fields && fields.length > 0 && (
              <section>
                <p className="font-medium text-gray-600 mb-2">
                  カスタムフィールド
                  <span className="font-normal text-gray-400 ml-1">（このコンテンツタイプの定義）</span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {fields.map((f) => (
                    <VarBadge
                      key={f.fieldId}
                      code={`{{fields.${f.fieldId}}}`}
                      desc={`${f.name}（${FIELD_TYPE_DESC[f.type]}）`}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* 日付フォーマット */}
            <section>
              <p className="font-medium text-gray-600 mb-2">日付フォーマット（formatDate ヘルパー）</p>
              <div className="bg-white border border-gray-200 rounded p-3 font-mono space-y-1 text-gray-700">
                <div>
                  <span className="text-blue-700">{"{{formatDate createdAt}}"}</span>
                  <span className="text-gray-400 ml-3">→ 2026年05月09日</span>
                </div>
                <div>
                  <span className="text-blue-700">{'{'}{'{'}{"formatDate createdAt \"YYYY/MM/DD\""}{'}'}{'}'}</span>
                  <span className="text-gray-400 ml-3">→ 2026/05/09</span>
                </div>
              </div>
            </section>

            {/* ページネーション */}
            <section>
              <p className="font-medium text-gray-600 mb-2">
                ページネーション
                <span className="font-normal text-gray-400 ml-1">（{'{{#each items}}'} の外側に記述）</span>
              </p>
              <div className="flex flex-wrap gap-1.5 mb-2">
                <VarBadge code="{{tools.hasNext}}" desc="次ページあり" />
                <VarBadge code="{{tools.hasPrev}}" desc="前ページあり" />
                <VarBadge code="{{tools.nextPage}}" desc="次ページ番号（数値）" />
                <VarBadge code="{{tools.prevPage}}" desc="前ページ番号（数値）" />
                <VarBadge code="{{tools.currentPage}}" desc="現在ページ" />
                <VarBadge code="{{tools.totalPages}}" desc="総ページ数" />
                <VarBadge code="{{tools.total}}" desc="総件数" />
                <VarBadge code="{{tools.nextHref}}" desc="/render の次ページ絶対URL" />
                <VarBadge code="{{tools.prevHref}}" desc="/render の前ページ絶対URL" />
              </div>
              <p className="text-gray-400 mb-2 text-xs">
                ⚠ tools.nextHref/prevHref は <code className="bg-white border px-1">https://xxx.cloudfront.net/api/v1/.../render?p=N</code> 形式の絶対URLです。<br />
                ブラウザで直接踏むとHTMLフラグメントが表示されます。利用目的を用途別に選んでください。
              </p>
              <div className="bg-white border border-gray-200 rounded p-3 font-mono text-gray-700 space-y-1">
                <div className="text-gray-400">{"{{!-- ① embed.js 埋め込み: data-cms-paginate で JS がインターセプト (推奨) --}}"}</div>
                <div>
                  <span className="text-purple-700">{"{{#if tools.hasPrev}}"}</span>
                  <span>{`<a data-cms-paginate href="{{tools.prevHref}}">前へ</a>`}</span>
                  <span className="text-purple-700">{"{{/if}}"}</span>
                </div>
                <div>
                  <span className="text-purple-700">{"{{#if tools.hasNext}}"}</span>
                  <span>{`<a data-cms-paginate href="{{tools.nextHref}}">次へ</a>`}</span>
                  <span className="text-purple-700">{"{{/if}}"}</span>
                </div>
                <div className="text-gray-400 mt-2">{"{{!-- ② PHP file_get_contents で連鎖取得 (SEO向け) --}}"}</div>
                <div className="text-gray-400 text-xs">{"// PHP側: echo file_get_contents($tools_nextHref); で次ページのHTMLを取得"}</div>
                <div className="text-gray-400 mt-2">{"{{!-- ③ 自前URL にページ番号だけ渡す場合 --}}"}</div>
                <div>
                  <span className="text-purple-700">{"{{#if tools.hasNext}}"}</span>
                  <span>{`<a href="/my-page?p={{tools.nextPage}}">次へ</a>`}</span>
                  <span className="text-purple-700">{"{{/if}}"}</span>
                </div>
              </div>
            </section>

          </div>
        )}
      </div>

      {/* body */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-sm font-medium text-gray-700">
            テンプレート本文（Handlebars）
          </label>
          <button
            type="button"
            onClick={handlePreview}
            disabled={previewing || body.trim().length === 0}
            className="admin-btn text-sm"
          >
            {previewing ? 'レンダリング中...' : 'プレビュー'}
          </button>
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="admin-input w-full font-mono text-sm"
          rows={24}
          spellCheck={false}
        />
      </div>

      {/* ボタン */}
      <div className="flex items-center justify-between pt-2">
        <button type="submit" disabled={saving} className="admin-btn admin-btn--primary">
          {saving ? '保存中...' : isEdit ? '更新する' : '作成する'}
        </button>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push(`/admin/sites/${siteId}/content-types/${ctId}/templates`)}
            className="admin-btn"
          >
            キャンセル
          </button>
          {isEdit && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={saving}
              className="admin-btn text-red-600 border-red-300 hover:bg-red-50"
            >
              削除
            </button>
          )}
        </div>
      </div>
    </form>

    {/* プレビューオーバーレイ: ダミーデータでHandlebarsレンダリング結果をiframe表示 */}
    {previewHtml !== null && (
      <div className="fixed inset-0 bg-black/60 z-50 flex flex-col">
        <div className="flex items-center justify-between bg-white border-b px-4 py-2 shrink-0">
          <span className="font-medium text-gray-800 text-sm">テンプレートプレビュー（ダミーデータ）</span>
          <button
            type="button"
            onClick={() => setPreviewHtml(null)}
            className="admin-btn text-sm"
          >
            閉じる
          </button>
        </div>
        <iframe
          srcDoc={previewHtml}
          className="flex-1 bg-white"
          title="template-preview"
        />
      </div>
    )}
    </>
  );
}
