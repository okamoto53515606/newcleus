/**
 * 公開 API 共通ユーティリティ
 *
 * why: /api/v1 エンドポイント（items / render / embed.js）で共通する
 *      パラメータバリデーション・DynamoDB アクセス・Handlebars ヘルパー登録を
 *      ここに集約する。管理 API とは分離し、Cognito 認証不要の公開ロジックのみを扱う。
 */

import Handlebars from 'handlebars';
import { getDocClient, Tables, Indexes } from './dynamodb';
import { QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import type { ItemRecord } from '@/app/api/admin/sites/[siteId]/items/route';
import type { ContentTypeRecord } from '@/app/api/admin/sites/[siteId]/content-types/route';
import type { SiteRecord } from '@/app/api/admin/sites/route';
import type { TemplateRecord } from '@/app/api/admin/sites/[siteId]/content-types/[ctId]/templates/route';

// ─── CORS ─────────────────────────────────────────────────────────────────────
// why: 公開 API は利用者の任意ドメインから呼ばれるため CORS を全許可する（blueprint §3）
export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};

// ─── バリデーション ────────────────────────────────────────────────────────────
// why: 公開 API は外部入力を直接受け取るため allowlist + 正規表現で厳格バリデーションする。
//      DynamoDB キーとして使う値は特に英数字・ハイフン・アンダーバーのみ許可し、
//      SQL インジェクション等の混入を防ぐ。
const SAFE_ID_RE = /^[a-zA-Z0-9_-]{1,100}$/;
const SAFE_SHORTNAME_RE = /^[a-z0-9-]{1,50}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const SORT_BY_ALLOWED = new Set<string>([
  'createdAt',
  ...Array.from({ length: 10 }, (_, i) => `num${i}`),
  ...Array.from({ length: 10 }, (_, i) => `date${i}`),
]);

export function isSafeId(v: string): boolean {
  return SAFE_ID_RE.test(v);
}

export function isValidShortname(v: string): boolean {
  return SAFE_SHORTNAME_RE.test(v);
}

export function parseLimit(v: string | null, defaultVal = 10, max = 100): number {
  const n = parseInt(v ?? '', 10);
  if (!Number.isFinite(n) || n < 1) return defaultVal;
  return Math.min(n, max);
}

export function parsePage(v: string | null): number {
  const n = parseInt(v ?? '', 10);
  return !Number.isFinite(n) || n < 1 ? 1 : n;
}

export function isValidDate(v: string): boolean {
  if (!DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00.000Z`);
  return !isNaN(d.getTime());
}

export function isValidSortBy(v: string): boolean {
  return SORT_BY_ALLOWED.has(v);
}

// ─── DynamoDB アクセス ─────────────────────────────────────────────────────────

/** サイトの存在確認 */
export async function fetchSite(siteId: string): Promise<SiteRecord | null> {
  const db = getDocClient();
  const r = await db.send(new GetCommand({ TableName: Tables.sites, Key: { siteId } }));
  return r.Item ? (r.Item as SiteRecord) : null;
}

/** コンテンツタイプの存在確認 */
export async function fetchContentType(
  siteId: string,
  ctId: string,
): Promise<ContentTypeRecord | null> {
  const db = getDocClient();
  const r = await db.send(
    new GetCommand({ TableName: Tables.contentTypes, Key: { siteId, ctId } }),
  );
  return r.Item ? (r.Item as ContentTypeRecord) : null;
}

/**
 * GSI1 (items-by-site-content-type) で公開済みアイテムを全件取得
 *
 * why: PK = siteContentTypeKey (= "{siteId}#{ctId}") で絞り込むことで
 *      サイト全体スキャンを避け、コンテンツタイプ単位のクエリを効率化する。
 *      DynamoDB の 1MB ページ制限に対応するため LastEvaluatedKey ループで全件取得する。
 */
export async function fetchPublishedItems(
  siteId: string,
  ctId: string,
): Promise<ItemRecord[]> {
  const db = getDocClient();
  const pk = `${siteId}#${ctId}`;
  const allItems: ItemRecord[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await db.send(
      new QueryCommand({
        TableName: Tables.items,
        IndexName: Indexes.itemsBySiteContentType,
        KeyConditionExpression: 'siteContentTypeKey = :pk',
        FilterExpression: '#s = :published',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':pk': pk, ':published': 'published' },
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      }),
    );
    allItems.push(...((result.Items ?? []) as ItemRecord[]));
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  return allItems;
}

/**
 * ctId + shortname でテンプレートを取得
 *
 * why: テンプレートテーブルには shortname の GSI がデプロイされていないため、
 *      ctId で全件 Query した後にアプリ側で shortname を照合する。
 *      1 コンテンツタイプのテンプレート数は通常 10 件未満のため性能問題なし。
 */
export async function fetchTemplateByShortname(
  ctId: string,
  shortname: string,
): Promise<TemplateRecord | null> {
  const db = getDocClient();
  const result = await db.send(
    new QueryCommand({
      TableName: Tables.templates,
      KeyConditionExpression: 'ctId = :ctId',
      ExpressionAttributeValues: { ':ctId': ctId },
    }),
  );
  const match = (result.Items ?? []).find((t) => t.shortname === shortname);
  return match ? (match as TemplateRecord) : null;
}

/**
 * ctId のテンプレート shortname 一覧を取得
 * why: template 未指定 or 存在しない場合のエラー応答で利用可能なテンプレートを案内するため
 */
export async function fetchTemplateShortnames(ctId: string): Promise<string[]> {
  const db = getDocClient();
  const result = await db.send(
    new QueryCommand({
      TableName: Tables.templates,
      KeyConditionExpression: 'ctId = :ctId',
      ExpressionAttributeValues: { ':ctId': ctId },
      ProjectionExpression: 'shortname',
    }),
  );
  return (result.Items ?? [])
    .map((t) => String(t.shortname ?? ''))
    .filter(Boolean);
}

// ─── フィルタ・ソート ──────────────────────────────────────────────────────────

export interface PublicItemsQuery {
  flags?: Record<string, boolean>;    // { flag0: true }
  texts?: Record<string, string>;     // { text0: "privacy-policy" }
  dateFrom?: Record<string, string>;  // { date0: "2026-01-01" }
  dateTo?: Record<string, string>;    // { date0: "2026-12-31" }
}

export function applyFilters(items: ItemRecord[], q: PublicItemsQuery): ItemRecord[] {
  return items.filter((item) => {
    const f = (item.fields ?? {}) as Record<string, unknown>;

    for (const [k, v] of Object.entries(q.flags ?? {})) {
      if (Boolean(f[k]) !== v) return false;
    }
    for (const [k, v] of Object.entries(q.texts ?? {})) {
      if (f[k] !== v) return false;
    }
    for (const [k, from] of Object.entries(q.dateFrom ?? {})) {
      if (String(f[k] ?? '') < from) return false;
    }
    for (const [k, to] of Object.entries(q.dateTo ?? {})) {
      if (String(f[k] ?? '') > to) return false;
    }
    return true;
  });
}

export function sortItems(
  items: ItemRecord[],
  sortBy: string,
  dir: 'asc' | 'desc',
): ItemRecord[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    let va: unknown;
    let vb: unknown;
    if (sortBy === 'createdAt') {
      va = a.createdAt;
      vb = b.createdAt;
    } else {
      va = (a.fields as Record<string, unknown>)?.[sortBy];
      vb = (b.fields as Record<string, unknown>)?.[sortBy];
    }
    if (va == null) return sign;
    if (vb == null) return -sign;
    if (va < vb) return -sign;
    if (va > vb) return sign;
    return 0;
  });
}

// ─── レスポンス整形 ────────────────────────────────────────────────────────────

export interface PublicItem {
  id: string;
  title: string;
  body: string;
  contentType: { id: string; name: string };
  fields: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export function toPublicItem(item: ItemRecord, ct: ContentTypeRecord): PublicItem {
  return {
    id: item.itemId,
    title: item.title,
    body: item.body,
    contentType: { id: ct.ctId, name: ct.name },
    fields: (item.fields ?? {}) as Record<string, unknown>,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

// ─── ページネーション ──────────────────────────────────────────────────────────

export interface PaginationTools {
  total: number;
  currentPage: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
  nextPage: number;
  prevPage: number;
  nextHref: string | null;
  prevHref: string | null;
}

/**
 * ページネーション情報を構築する
 *
 * why: Handlebars テンプレート内で {{tools.nextHref}} 等を使って
 *      ページャ UI を描画できるようにするため。
 *      /render の baseUrl を渡すことで、テンプレートに埋め込まれた
 *      ページングリンクが正しい URL を指す。
 */
export function buildTools(
  total: number,
  page: number,
  limit: number,
  baseUrl: string,
  searchParams: URLSearchParams,
): PaginationTools {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const hasNext = page < totalPages;
  const hasPrev = page > 1;

  function pageUrl(p: number): string {
    const u = new URLSearchParams(searchParams);
    u.set('page', String(p));
    return `${baseUrl}?${u.toString()}`;
  }

  return {
    total,
    currentPage: page,
    totalPages,
    hasNext,
    hasPrev,
    nextPage: hasNext ? page + 1 : page,
    prevPage: hasPrev ? page - 1 : page,
    nextHref: hasNext ? pageUrl(page + 1) : null,
    prevHref: hasPrev ? pageUrl(page - 1) : null,
  };
}

/**
 * 公開済みの単一アイテムを取得する
 *
 * why: /render の itemId パラメータや embed.js のモーダル表示用に
 *      siteId + itemId で直接 GetItem する。
 *      contentTypeId の一致確認で、他サイト・他コンテンツタイプの記事が
 *      返ることを防ぐ（セキュリティ + 不整合防止）。
 */
export async function fetchPublishedItemById(
  siteId: string,
  itemId: string,
  contentTypeId: string,
): Promise<ItemRecord | null> {
  const db = getDocClient();
  const r = await db.send(
    new GetCommand({ TableName: Tables.items, Key: { siteId, itemId } }),
  );
  if (!r.Item) return null;
  const item = r.Item as ItemRecord;
  if (item.status !== 'published' || item.contentTypeId !== contentTypeId) return null;
  return item;
}

// ─── Handlebars ヘルパー ────────────────────────────────────────────────────────

let helpersRegistered = false;

/**
 * 公開 API 用 Handlebars ヘルパーを登録する（冪等）
 *
 * why: /render と管理画面 /api/admin/preview で同じヘルパーを使うことで
 *      プレビューと本番出力が一致することを保証する。
 *      Lambda 環境ではモジュールがシングルトンになるため二重登録を防ぐフラグを持つ。
 */
export function registerHandlebarsHelpers(): void {
  if (helpersRegistered) return;
  helpersRegistered = true;

  // formatDate: 日付文字列を指定フォーマットに変換
  // 使用例: {{formatDate createdAt "YYYY年MM月DD日"}} または {{formatDate createdAt}}
  Handlebars.registerHelper('formatDate', (dateStr: string, fmt: unknown) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    const pattern = typeof fmt === 'string' ? fmt : 'YYYY年MM月DD日';
    return pattern
      .replace('YYYY', String(d.getFullYear()))
      .replace('MM', String(d.getMonth() + 1).padStart(2, '0'))
      .replace('DD', String(d.getDate()).padStart(2, '0'))
      .replace('M', String(d.getMonth() + 1))
      .replace('D', String(d.getDate()));
  });
}
