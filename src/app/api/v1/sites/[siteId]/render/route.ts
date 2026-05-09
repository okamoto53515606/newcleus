/**
 * 公開 API — Handlebars テンプレート適用済み HTML を返す
 *
 * GET /api/v1/sites/{siteId}/render
 *
 * 必須:
 *   ?contentType={ctId}              コンテンツタイプ ID
 *   &template={templateShortname}    テンプレート shortname（例: list, ticker）
 *
 * 任意: /items と同じ（limit, page, sort, sort_by, flag0-9, text0-9, date0_from/to）
 *
 * why: PHP など非 JS 環境でのサーバーサイドインクルードや embed.js の内部呼び出しに使用。
 *      テンプレートエンジン Handlebars でレンダリングし Content-Type: text/html で返す。
 *      記事 0 件時は空文字列を返す（embed.js で何も描画しない）。
 *      template 未指定時は 400 + 利用可能な shortname 一覧を返す（blueprint §6 仕様）。
 *      テンプレートコンパイルエラー時はサーバーログのみ出力し、クライアントには空を返す。
 */

import { NextRequest, NextResponse } from 'next/server';
import Handlebars from 'handlebars';
import {
  CORS_HEADERS,
  isSafeId,
  isValidShortname,
  parseLimit,
  parsePage,
  isValidDate,
  isValidSortBy,
  fetchSite,
  fetchContentType,
  fetchPublishedItems,
  fetchTemplateByShortname,
  fetchTemplateShortnames,
  applyFilters,
  sortItems,
  buildTools,
  registerHandlebarsHelpers,
  fetchPublishedItemById,
  type PublicItemsQuery,
} from '@/lib/public-api';
import { getPublicOrigin } from '@/lib/origin';

export const dynamic = 'force-dynamic';

function htmlHeaders(): Record<string, string> {
  return {
    ...CORS_HEADERS,
    'Content-Type': 'text/html; charset=utf-8',
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  const { siteId } = await params;
  const sp = req.nextUrl.searchParams;

  // ─── パスパラメータ検証 ────────────────────────────────────────────────────
  if (!isSafeId(siteId)) {
    return NextResponse.json(
      { error: 'Invalid siteId' },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  // ─── 必須パラメータ: contentType ──────────────────────────────────────────
  const contentType = sp.get('contentType')?.trim() ?? '';
  if (!contentType) {
    return NextResponse.json(
      { error: 'contentType は必須です' },
      { status: 400, headers: CORS_HEADERS },
    );
  }
  if (!isSafeId(contentType)) {
    return NextResponse.json(
      { error: 'contentType の値が不正です' },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  // ─── 必須パラメータ: template ──────────────────────────────────────────────
  // why: template 未指定時は利用可能な shortname 一覧を案内する（blueprint §6 仕様）
  const templateShortname = sp.get('template')?.trim() ?? '';
  if (!templateShortname) {
    const [site, ct] = await Promise.all([fetchSite(siteId), fetchContentType(siteId, contentType)]);
    if (!site || !ct) {
      return NextResponse.json({ error: 'Not found' }, { status: 404, headers: CORS_HEADERS });
    }
    const available = await fetchTemplateShortnames(ct.ctId);
    return NextResponse.json(
      { error: 'template は必須です', availableTemplates: available },
      { status: 400, headers: CORS_HEADERS },
    );
  }
  if (!isValidShortname(templateShortname)) {
    return NextResponse.json(
      { error: 'template の値が不正です（英小文字・数字・ハイフンのみ）' },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  // ─── itemId 値定時: 単一記事レンダリング（早期リターン）─────────────────────────
  // why: itemId が指定された場合はページネーション・フィルタ・ソートが不要なため、
  //      引数解析をスキップして直接レンダリングに入る。
  //      embed.js のモーダル表示（一覧から記事詳細を開く）で使用する。
  const rawItemId = sp.get('itemId')?.trim() ?? '';
  if (rawItemId) {
    if (!isSafeId(rawItemId)) {
      return NextResponse.json(
        { error: 'itemId の値が不正です' },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    const [site, ct] = await Promise.all([
      fetchSite(siteId),
      fetchContentType(siteId, contentType),
    ]);
    if (!site || !ct) {
      return NextResponse.json({ error: 'Not found' }, { status: 404, headers: CORS_HEADERS });
    }

    const template = await fetchTemplateByShortname(ct.ctId, templateShortname);
    if (!template) {
      const available = await fetchTemplateShortnames(ct.ctId);
      return NextResponse.json(
        { error: `テンプレート "${templateShortname}" が見つかりません`, availableTemplates: available },
        { status: 404, headers: CORS_HEADERS },
      );
    }

    const item = await fetchPublishedItemById(siteId, rawItemId, ct.ctId);
    // why: 存在しない/非公開を区別しない。公開記事以外は空 HTML を返す。
    if (!item) {
      return new NextResponse('', { status: 200, headers: htmlHeaders() });
    }

    registerHandlebarsHelpers();
    const renderItem = {
      id: item.itemId,
      itemId: item.itemId,
      title: item.title,
      body: item.body,
      contentType: { id: ct.ctId, name: ct.name },
      fields: (item.fields ?? {}) as Record<string, unknown>,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
    // 単一記事はページネーションなし
    const singleTools = {
      total: 1, currentPage: 1, totalPages: 1,
      hasNext: false, hasPrev: false,
      nextPage: 1, prevPage: 1, nextHref: null, prevHref: null,
    };
    let singleHtml: string;
    try {
      const compiled = Handlebars.compile(template.body, { noEscape: false });
      singleHtml = compiled({ items: [renderItem], item: renderItem, tools: singleTools });
    } catch (err) {
      console.error('[newcleus/render] template compile error (single item):', err);
      return new NextResponse('', { status: 200, headers: htmlHeaders() });
    }
    return new NextResponse(singleHtml, { status: 200, headers: htmlHeaders() });
  }
  const limit = parseLimit(sp.get('limit'), 10, 100);
  const page = parsePage(sp.get('page'));

  const rawSort = sp.get('sort') ?? 'desc';
  if (rawSort !== 'asc' && rawSort !== 'desc') {
    return NextResponse.json(
      { error: 'sort は "desc" または "asc" を指定してください' },
      { status: 400, headers: CORS_HEADERS },
    );
  }
  const sort = rawSort as 'asc' | 'desc';

  const rawSortBy = sp.get('sort_by') ?? 'createdAt';
  if (!isValidSortBy(rawSortBy)) {
    return NextResponse.json(
      { error: 'sort_by の値が不正です（createdAt / num0〜num9 / date0〜date9 のみ有効）' },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const flags: Record<string, boolean> = {};
  for (let i = 0; i < 10; i++) {
    const val = sp.get(`flag${i}`);
    if (val !== null) {
      if (!['0', '1', 'true', 'false'].includes(val)) {
        return NextResponse.json(
          { error: `flag${i} は 0/1 または true/false を指定してください` },
          { status: 400, headers: CORS_HEADERS },
        );
      }
      flags[`flag${i}`] = val === '1' || val === 'true';
    }
  }

  const texts: Record<string, string> = {};
  for (let i = 0; i < 10; i++) {
    const val = sp.get(`text${i}`);
    if (val !== null) {
      const trimmed = val.trim();
      if (trimmed.length > 200) {
        return NextResponse.json(
          { error: `text${i} は最大200文字です` },
          { status: 400, headers: CORS_HEADERS },
        );
      }
      if (trimmed) texts[`text${i}`] = trimmed;
    }
  }

  const dateFrom: Record<string, string> = {};
  const dateTo: Record<string, string> = {};
  for (let i = 0; i < 10; i++) {
    const fromVal = sp.get(`date${i}_from`);
    const toVal = sp.get(`date${i}_to`);
    if (fromVal !== null) {
      if (!isValidDate(fromVal)) {
        return NextResponse.json(
          { error: `date${i}_from は YYYY-MM-DD 形式で指定してください` },
          { status: 400, headers: CORS_HEADERS },
        );
      }
      dateFrom[`date${i}`] = fromVal;
    }
    if (toVal !== null) {
      if (!isValidDate(toVal)) {
        return NextResponse.json(
          { error: `date${i}_to は YYYY-MM-DD 形式で指定してください` },
          { status: 400, headers: CORS_HEADERS },
        );
      }
      dateTo[`date${i}`] = toVal;
    }
  }

  // ─── DB アクセス ──────────────────────────────────────────────────────────
  const [site, ct] = await Promise.all([fetchSite(siteId), fetchContentType(siteId, contentType)]);
  if (!site || !ct) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: CORS_HEADERS });
  }

  // テンプレート取得（存在しない場合は 404 + 利用可能な一覧を案内）
  const template = await fetchTemplateByShortname(ct.ctId, templateShortname);
  if (!template) {
    const available = await fetchTemplateShortnames(ct.ctId);
    return NextResponse.json(
      {
        error: `テンプレート "${templateShortname}" が見つかりません`,
        availableTemplates: available,
      },
      { status: 404, headers: CORS_HEADERS },
    );
  }

  // ─── データ取得・フィルタ・ソート ─────────────────────────────────────────
  const query: PublicItemsQuery = { flags, texts, dateFrom, dateTo };
  let items = await fetchPublishedItems(siteId, contentType);
  items = applyFilters(items, query);
  items = sortItems(items, rawSortBy, sort);

  const total = items.length;
  const start = (page - 1) * limit;
  const pagedItems = items.slice(start, start + limit);

  // 0 件の場合は空 HTML を返す（embed.js で何も表示しない）
  if (pagedItems.length === 0) {
    return new NextResponse('', { status: 200, headers: htmlHeaders() });
  }

  // ─── Handlebars レンダリング ─────────────────────────────────────────────
  registerHandlebarsHelpers();

  // テンプレート変数: items (配列), item (先頭1件), tools (ページネーション情報)
  // why: itemId も含めてテンプレートから参照できるようにする（data-cms-modal 等のUX用途）
  const renderItems = pagedItems.map((item) => ({
    id: item.itemId,
    itemId: item.itemId,
    title: item.title,
    body: item.body,
    contentType: { id: ct.ctId, name: ct.name },
    fields: (item.fields ?? {}) as Record<string, unknown>,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }));

  const origin = getPublicOrigin(req);
  const baseRenderUrl = `${origin}/api/v1/sites/${siteId}/render`;
  const tools = buildTools(total, page, limit, baseRenderUrl, sp);

  let html: string;
  try {
    const compiled = Handlebars.compile(template.body, { noEscape: false });
    html = compiled({ items: renderItems, item: renderItems[0], tools });
  } catch (err) {
    // why: テンプレートのコンパイルエラーはサーバーログのみ出力し、
    //      クライアントには空文字列を返すことでサイトの表示を壊さない
    console.error('[newcleus/render] template compile error:', err);
    return new NextResponse('', { status: 200, headers: htmlHeaders() });
  }

  return new NextResponse(html, { status: 200, headers: htmlHeaders() });
}
