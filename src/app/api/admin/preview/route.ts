/**
 * テンプレートプレビュー API
 *
 * why: テンプレート編集フォームから Handlebars 本文とフィールド定義を受け取り、
 *      ダミーデータでレンダリングした HTML を返す。
 *      本番の /render エンドポイントは DynamoDB からアイテムを取得するが、
 *      プレビューはフィールド定義さえあれば DB アクセス不要でレンダリングできる。
 *      embed.js は不要（プレビューは iframe で静的 HTML を表示するだけ）。
 */

import { NextRequest, NextResponse } from 'next/server';
import Handlebars from 'handlebars';
import { getAdminUser } from '@/lib/admin-auth';
import type { FieldDefinition } from '@/app/api/admin/sites/[siteId]/content-types/route';

export const dynamic = 'force-dynamic';

// ─── Handlebars ヘルパー ───────────────────────────────────────────────
// why: /render と同じヘルパーを登録しておくことで、本番環境と同じ出力を確認できる
Handlebars.registerHelper('formatDate', (dateStr: string, fmt: string) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const fmt_ = typeof fmt === 'string' ? fmt : 'YYYY年MM月DD日';
  return fmt_
    .replace('YYYY', String(d.getFullYear()))
    .replace('MM', String(d.getMonth() + 1).padStart(2, '0'))
    .replace('DD', String(d.getDate()).padStart(2, '0'))
    .replace('M', String(d.getMonth() + 1))
    .replace('D', String(d.getDate()));
});

// ─── ダミーデータ生成 ────────────────────────────────────────────────
function buildDummyItems(fields: FieldDefinition[], count = 3) {
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    const fieldsData: Record<string, string | number | boolean> = {};
    for (const f of fields) {
      switch (f.type) {
        case 'text':    fieldsData[f.fieldId] = `${f.name}のサンプルテキスト ${n}`; break;
        case 'file':    fieldsData[f.fieldId] = 'https://placehold.co/400x300?text=sample'; break;
        case 'flag':    fieldsData[f.fieldId] = i % 2 === 0; break;
        case 'date':    fieldsData[f.fieldId] = '2026-05-09'; break;
        case 'num':     fieldsData[f.fieldId] = n * 100; break;
      }
    }
    return {
      id: `dummy-${n}`,
      itemId: `dummy-${n}`,
      title: `サンプル記事 ${n}`,
      body: `<p>これはダミーの記事本文 ${n} です。</p>`,
      status: 'published',
      createdAt: '2026-05-09T10:00:00.000Z',
      updatedAt: '2026-05-09T10:00:00.000Z',
      fields: fieldsData,
    };
  });
}

/**
 * POST /api/admin/preview
 * body: { templateBody: string; fields?: FieldDefinition[]; ctId?: string }
 * response: { html: string }
 */
export async function POST(req: NextRequest) {
  const user = await getAdminUser();
  if (!user?.isAuthenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { templateBody?: unknown; fields?: unknown; ctId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const templateBody = typeof body.templateBody === 'string' ? body.templateBody : '';
  if (!templateBody.trim()) {
    return NextResponse.json({ error: 'templateBody is required' }, { status: 400 });
  }

  const fields: FieldDefinition[] = Array.isArray(body.fields) ? (body.fields as FieldDefinition[]) : [];

  // ダミーデータを生成
  const dummyItems = buildDummyItems(fields, 3);
  const tools = {
    total: 3,
    currentPage: 1,
    totalPages: 2,
    hasNext: true,
    hasPrev: false,
    nextPage: 2,
    prevPage: 1,
    nextHref: 'https://example.cloudfront.net/api/v1/sites/demo/render?p=2',
    prevHref: 'https://example.cloudfront.net/api/v1/sites/demo/render?p=1',
  };

  try {
    const template = Handlebars.compile(templateBody, { noEscape: false });
    // リスト表示 ({#each items}) と詳細表示 ({#with item}) の両方に対応
    const rendered = template({ items: dummyItems, item: dummyItems[0], tools });

    // ─── プレビュー用インタラクションスクリプトを注入 ───────────────────
    // why: embed.js が担うはずの [data-cms-modal] モーダル表示と
    //      [data-cms-paginate] ページャ制御をプレビュー内で再現する。
    //      ダミー item の body をインライン JSON として埋め込み、
    //      fetch なしでモーダルコンテンツを表示する。
    const dummyBodyMap = Object.fromEntries(
      dummyItems.map((item) => [item.id, item.body]),
    );
    const previewScript = `<script>
(function () {
  var bodies = ${JSON.stringify(dummyBodyMap)};
  function init() {
    var overlay = document.querySelector('.nc-modal-overlay');
    var modalBody = overlay && overlay.querySelector('.nc-modal-body');
    var closeBtn = overlay && overlay.querySelector('.nc-modal-close');
    if (overlay && modalBody) {
      document.querySelectorAll('[data-cms-modal]').forEach(function (el) {
        el.style.cursor = 'pointer';
        el.addEventListener('click', function () {
          var id = el.getAttribute('data-cms-modal');
          modalBody.innerHTML = bodies[id] || '<p>（本文なし）</p>';
          overlay.classList.add('is-open');
        });
      });
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) overlay.classList.remove('is-open');
      });
      if (closeBtn) closeBtn.addEventListener('click', function () {
        overlay.classList.remove('is-open');
      });
    }
    // data-cms-paginate はプレビューではページ遷移しない（href="#"に差し替え）
    document.querySelectorAll('[data-cms-paginate]').forEach(function (el) {
      el.setAttribute('href', '#');
      el.addEventListener('click', function (e) { e.preventDefault(); });
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
<\/script>`;

    // フルHTML（<!DOCTYPE html>）ならば </body> 直前に、フラグメントなら末尾に注入
    const html = rendered.includes('</body>')
      ? rendered.replace('</body>', previewScript + '</body>')
      : rendered + previewScript;

    return NextResponse.json({ html });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `テンプレート構文エラー: ${msg}` }, { status: 422 });
  }
}
