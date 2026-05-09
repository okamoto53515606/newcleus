/**
 * サイト初期化ユーティリティ
 *
 * why: 新規サイト作成直後にすぐ使い始められるよう、典型的なコンテンツタイプ（お知らせ・
 *      フォトギャラリー）と、embed.js で動くスターターテンプレートを自動投入する。
 *      ユーザーが手動でコンテンツタイプ→テンプレートを作る手間を省き、
 *      最初の embed タグをすぐコピーできる状態を作ることが目的。
 */

import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomBytes } from 'crypto';
import { Tables } from '@/lib/dynamodb';

function genId(): string {
  return randomBytes(10).toString('hex');
}

// ─── テンプレート本文ビルダー ──────────────────────────────────────────────────

/**
 * お知らせ — 記事一覧（モーダル）テンプレート
 *
 * why: title クリックで詳細をモーダル表示する最も汎用的なパターン。
 *      embed.js が [data-cms-modal] を検出して /render?itemId=xxx を fetch するため
 *      インライン JS は不要。CSSクラスは ct-{ctId} でスコープする。
 */
function buildNewsListModal(ctId: string): string {
  return `<style>
.ct-${ctId} .nc-item { border-bottom: 1px solid #eee; padding: 8px 0; display: flex; gap: 12px; align-items: baseline; }
.ct-${ctId} .nc-date { color: #888; font-size: .875rem; white-space: nowrap; }
.ct-${ctId} .nc-title { cursor: pointer; color: #0066cc; }
.ct-${ctId} .nc-title:hover { text-decoration: underline; }
.ct-${ctId} .nc-pager { display: flex; gap: 8px; margin-top: 1em; }
.ct-${ctId} .nc-pager a { color: #0066cc; text-decoration: none; }
.ct-${ctId} .nc-modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.5); z-index: 9999; align-items: center; justify-content: center; }
.ct-${ctId} .nc-modal-overlay.is-open { display: flex; }
.ct-${ctId} .nc-modal { background: #fff; border-radius: 8px; padding: 24px; max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto; position: relative; }
.ct-${ctId} .nc-modal-close { position: absolute; top: 12px; right: 16px; font-size: 1.5rem; cursor: pointer; background: none; border: none; }
</style>

<div class="ct-${ctId}">
  {{#each items}}
  <div class="nc-item">
    <span class="nc-date">{{formatDate createdAt "YYYY/MM/DD"}}</span>
    <span class="nc-title" data-cms-modal="{{id}}">{{title}}</span>
  </div>
  {{/each}}

  <div class="nc-pager">
    {{#if tools.hasPrev}}<a data-cms-paginate href="{{tools.prevHref}}">前へ</a>{{/if}}
    {{#if tools.hasNext}}<a data-cms-paginate href="{{tools.nextHref}}">次へ</a>{{/if}}
  </div>

  <div class="nc-modal-overlay">
    <div class="nc-modal">
      <button class="nc-modal-close" aria-label="閉じる">&times;</button>
      <div class="nc-modal-body"></div>
    </div>
  </div>
</div>`;
}

/**
 * お知らせ / フォトギャラリー — 詳細（フラグメント）テンプレート
 *
 * why: embed.js のモーダル内に注入するケースもあるため、
 *      <html>/<head>/<body> を持たないフラグメント形式で記述する。
 */
function buildNewsDetail(): string {
  return `<style>
.nc-detail-body img { max-width: 100%; height: auto; }
</style>
{{#with item}}
<article>
  <p style="color:#888;font-size:.875rem">{{formatDate createdAt "YYYY年MM月DD日"}}</p>
  <h2>{{title}}</h2>
  <div class="nc-detail-body">{{{body}}}</div>
</article>
{{/with}}`;
}

/**
 * フォトギャラリー — スライドショーテンプレート
 *
 * why: 写真を1枚ずつ全幅で表示し、一定間隔で自動的に切り替えるカルーセル。
 *      ドットナビゲーションで任意のコマに移動できる。
 *      embed.js が execScripts() で <script> を再実行するため、
 *      IIFE で書くことでページに複数埋め込まれても競合しない。
 *      ID に {{tools.currentPage}} を含めることで同一ページ内の複数インスタンスを区別する。
 */
function buildGallerySlideshow(ctId: string): string {
  return `<style>
.ct-${ctId}-sw { overflow: hidden; position: relative; }
.ct-${ctId}-sw .nc-track { display: flex; transition: transform 0.5s ease; }
.ct-${ctId}-sw .nc-slide { min-width: 100%; flex-shrink: 0; text-align: center; }
.ct-${ctId}-sw .nc-slide img { max-width: 100%; height: auto; display: block; margin: 0 auto; }
.ct-${ctId}-sw .nc-caption { padding: 6px 0 2px; color: #555; font-size: .875rem; }
.ct-${ctId}-sw .nc-shot-date { color: #999; font-size: .8rem; }
.ct-${ctId}-sw .nc-dots { display: flex; justify-content: center; gap: 6px; margin-top: 10px; }
.ct-${ctId}-sw .nc-dot { width: 9px; height: 9px; border-radius: 50%; background: #ccc; cursor: pointer; border: none; padding: 0; transition: background .2s; }
.ct-${ctId}-sw .nc-dot.is-active { background: #555; }
</style>

<div class="ct-${ctId}-sw" id="nc-sw-${ctId}-{{tools.currentPage}}">
  <div class="nc-track">
    {{#each items}}
    <div class="nc-slide">
      {{#if fields.file0}}<img src="{{fields.file0}}" alt="{{title}}">{{/if}}
      <p class="nc-caption">{{#if fields.text0}}{{fields.text0}}{{else}}{{title}}{{/if}}</p>
      {{#if fields.date0}}<p class="nc-shot-date">{{formatDate fields.date0 "YYYY年MM月DD日"}}</p>{{/if}}
    </div>
    {{/each}}
  </div>

  <div class="nc-dots">
    {{#each items}}
    <button class="nc-dot{{#if @first}} is-active{{/if}}" data-idx="{{@index}}" aria-label="{{@index}}枚目"></button>
    {{/each}}
  </div>
</div>

<script>
(function () {
  var el = document.getElementById('nc-sw-${ctId}-{{tools.currentPage}}');
  if (!el) return;
  var track = el.querySelector('.nc-track');
  var dots  = el.querySelectorAll('.nc-dot');
  var total = dots.length;
  if (!track || total <= 1) return;

  var current = 0;
  function goTo(n) {
    current = (n + total) % total;
    track.style.transform = 'translateX(-' + (current * 100) + '%)';
    for (var i = 0; i < dots.length; i++) {
      dots[i].classList.toggle('is-active', i === current);
    }
  }

  for (var i = 0; i < dots.length; i++) {
    (function (n) {
      dots[n].addEventListener('click', function () { goTo(n); resetTimer(); });
    })(i);
  }

  var timer = setInterval(function () { goTo(current + 1); }, 4000);
  function resetTimer() {
    clearInterval(timer);
    timer = setInterval(function () { goTo(current + 1); }, 4000);
  }
})();
</script>`;
}

/**
 * フォトギャラリー — 写真詳細（フラグメント）テンプレート
 *
 * why: モーダル内への注入を想定し、フラグメント形式で記述する。
 */
function buildGalleryDetail(): string {
  return `{{#with item}}
<div style="text-align:center">
  {{#if fields.file0}}
  <img src="{{fields.file0}}" alt="{{title}}" style="max-width:100%;height:auto;display:block;margin:0 auto">
  {{/if}}
  <p style="color:#555;font-size:.875rem;margin-top:8px">
    {{#if fields.text0}}{{fields.text0}}{{else}}{{title}}{{/if}}
  </p>
  {{#if fields.date0}}
  <p style="color:#999;font-size:.8rem">{{formatDate fields.date0 "YYYY年MM月DD日"}}</p>
  {{/if}}
</div>
{{/with}}`;
}

// ─── メイン関数 ────────────────────────────────────────────────────────────────

/**
 * 新規サイトに初期コンテンツタイプ＋テンプレートをセットアップする
 *
 * why: サイト作成直後にすぐ embed タグを配置できる状態を作るため、
 *      お知らせ（フィールドなし）とフォトギャラリー（画像・キャプション・撮影日）の
 *      2つのコンテンツタイプと、それぞれに対応したテンプレートを一括投入する。
 *
 * エラーハンドリング: Promise.all で全件並列投入する。
 *      投入失敗時は呼び出し元でキャッチしてログ出力する（サイト作成自体は成功済み）。
 */
export async function initializeSite(
  siteId: string,
  db: DynamoDBDocumentClient,
): Promise<void> {
  const now = new Date().toISOString();
  const newsCtId    = genId();
  const galleryCtId = genId();

  // ─── コンテンツタイプ ────────────────────────────────────────────────────
  const newsCT = {
    siteId,
    ctId: newsCtId,
    name: 'お知らせ',
    description: '新着情報やお知らせを管理します',
    // why: title/body は全記事共通の固定フィールド。追加カスタムフィールドは不要。
    fields: [],
    createdAt: now,
    updatedAt: now,
  };

  const galleryCT = {
    siteId,
    ctId: galleryCtId,
    name: 'フォトギャラリー',
    description: '写真ギャラリーを管理します',
    fields: [
      { fieldId: 'file0', name: '画像',     type: 'file' },
      { fieldId: 'text0', name: 'キャプション', type: 'text' },
      { fieldId: 'date0', name: '撮影日',   type: 'date' },
    ],
    createdAt: now,
    updatedAt: now,
  };

  // ─── テンプレート（お知らせ）────────────────────────────────────────────
  const newsListModal = {
    ctId: newsCtId,
    templateId: genId(),
    siteId,
    name: '記事一覧（モーダル）',
    shortname: 'list-modal',
    body: buildNewsListModal(newsCtId),
    createdAt: now,
    updatedAt: now,
  };

  const newsDetail = {
    ctId: newsCtId,
    templateId: genId(),
    siteId,
    name: '記事詳細',
    shortname: 'detail',
    body: buildNewsDetail(),
    createdAt: now,
    updatedAt: now,
  };

  // ─── テンプレート（フォトギャラリー）──────────────────────────────────────
  const gallerySlideshow = {
    ctId: galleryCtId,
    templateId: genId(),
    siteId,
    name: 'スライドショー',
    shortname: 'slideshow',
    body: buildGallerySlideshow(galleryCtId),
    createdAt: now,
    updatedAt: now,
  };

  const galleryDetail = {
    ctId: galleryCtId,
    templateId: genId(),
    siteId,
    name: '写真詳細',
    shortname: 'detail',
    body: buildGalleryDetail(),
    createdAt: now,
    updatedAt: now,
  };

  // why: 全レコードを並列投入してレイテンシを最小化する。
  //      DynamoDB の PutCommand は冪等のため、万が一の重複実行でも安全。
  await Promise.all([
    db.send(new PutCommand({ TableName: Tables.contentTypes, Item: newsCT })),
    db.send(new PutCommand({ TableName: Tables.contentTypes, Item: galleryCT })),
    db.send(new PutCommand({ TableName: Tables.templates, Item: newsListModal })),
    db.send(new PutCommand({ TableName: Tables.templates, Item: newsDetail })),
    db.send(new PutCommand({ TableName: Tables.templates, Item: gallerySlideshow })),
    db.send(new PutCommand({ TableName: Tables.templates, Item: galleryDetail })),
  ]);
}
