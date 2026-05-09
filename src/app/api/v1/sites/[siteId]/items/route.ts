/**
 * 公開 API — 記事一覧
 *
 * GET /api/v1/sites/{siteId}/items
 *
 * 必須:
 *   ?contentType={ctId}          コンテンツタイプ ID
 *
 * 任意:
 *   &limit={1-100}               取得件数（デフォルト10）
 *   &page={n}                    ページ番号（デフォルト1）
 *   &sort=desc|asc               日付ソート（デフォルトdesc）
 *   &sort_by=createdAt|num0|...  ソートキー（デフォルトcreatedAt）
 *   &flag0=0|1                   汎用フラグフィルタ（flag0〜flag9）
 *   &text0={value}               テキスト完全一致フィルタ（text0〜text9）
 *   &date0_from=YYYY-MM-DD       日付範囲フィルタ（date0〜date9）
 *   &date0_to=YYYY-MM-DD
 *
 * why: Cognito 認証不要の公開 JSON API。CORS 全許可。
 *      GET / OPTIONS のみ受付。それ以外は Next.js が自動で 405 を返す。
 *      パラメータは allowlist で厳格バリデーションし不正値は 400 を返す。
 *      site / CT 不存在は情報漏洩を避けるため一律 404 を返す。
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  CORS_HEADERS,
  isSafeId,
  parseLimit,
  parsePage,
  isValidDate,
  isValidSortBy,
  fetchSite,
  fetchContentType,
  fetchPublishedItems,
  applyFilters,
  sortItems,
  toPublicItem,
  buildTools,
  type PublicItemsQuery,
} from '@/lib/public-api';
import { getPublicOrigin } from '@/lib/origin';

export const dynamic = 'force-dynamic';

/** OPTIONS: CORS プリフライト対応 */
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

  // ─── 必須クエリパラメータ ──────────────────────────────────────────────────
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

  // ─── オプションパラメータ検証 ──────────────────────────────────────────────
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

  // フラグフィルタ (flag0〜flag9)
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

  // テキスト完全一致フィルタ (text0〜text9)
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

  // 日付範囲フィルタ (date0_from/to〜date9_from/to)
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
  // why: site / CT の両方を並列取得し、どちらかが存在しなければ一律 404 を返す。
  //      詳細メッセージを出さないことで siteId の存在有無が外部に漏れるのを防ぐ。
  const [site, ct] = await Promise.all([
    fetchSite(siteId),
    fetchContentType(siteId, contentType),
  ]);
  if (!site || !ct) {
    return NextResponse.json(
      { error: 'Not found' },
      { status: 404, headers: CORS_HEADERS },
    );
  }

  // ─── データ取得・フィルタ・ソート・ページネーション ───────────────────────
  const query: PublicItemsQuery = { flags, texts, dateFrom, dateTo };
  let items = await fetchPublishedItems(siteId, contentType);
  items = applyFilters(items, query);
  items = sortItems(items, rawSortBy, sort);

  const total = items.length;
  const start = (page - 1) * limit;
  const pagedItems = items.slice(start, start + limit);
  const origin = getPublicOrigin(req);
  const baseUrl = `${origin}/api/v1/sites/${siteId}/items`;
  const tools = buildTools(total, page, limit, baseUrl, sp);

  const publicItems = pagedItems.map((item) => toPublicItem(item, ct, origin));

  return NextResponse.json(
    { items: publicItems, total, page, limit, tools },
    { headers: CORS_HEADERS },
  );
}
