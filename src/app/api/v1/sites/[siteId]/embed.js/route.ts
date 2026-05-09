/**
 * 公開 API — embed.js スクリプト配信
 *
 * GET /api/v1/sites/{siteId}/embed.js
 *
 * why: 利用者がサイトに <script> タグを1行追加するだけで
 *      newcleus のコンテンツを埋め込めるようにするため。
 *      このエンドポイントは IIFE JavaScript を返し、
 *      ページロード時に自動的に /render にリクエストして HTML を取得・描画する。
 *
 * セキュリティ:
 *   - siteId は allowlist バリデーション（isSafeId）
 *   - 生成する JS は外部入力を innerHTML に注入しない（/render から受け取った HTML を挿入するだけ）
 *   - /render 側で適切な出力エスケープを行う責務を持つ
 *   - contentType は siteId と共に URL パスに埋め込まれず、クエリパラメータ経由で /render に転送
 *
 * キャッシュ:
 *   - public, max-age=3600 (1時間) CDN でキャッシュ可能
 *   - スクリプト内容が変わらない限りキャッシュを活かすため、JS は毎回同一の内容を返す
 */

import { NextRequest, NextResponse } from 'next/server';
import { isSafeId, CORS_HEADERS } from '@/lib/public-api';
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

  if (!isSafeId(siteId)) {
    // why: JS ファイルとして返すため、エラーもコンソール出力用 JS で返す
    const errJs = `console.error('[newcleus] embed.js: siteId が不正です');`;
    return new NextResponse(errJs, {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/javascript; charset=utf-8' },
    });
  }

  const origin = getPublicOrigin(req);
  const script = buildEmbedScript(siteId, origin);

  return new NextResponse(script, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/javascript; charset=utf-8',
      // why: 1 時間キャッシュを許可する。siteId が変わらない限り内容も変わらないため安全
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

/**
 * 埋め込み用 IIFE スクリプトを生成する
 *
 * 利用者は下記のようにスクリプトタグを HTML に記述する:
 *
 *   <script
 *     src="https://xxxx.cloudfront.net/api/v1/sites/SITE_ID/embed.js"
 *     data-content-type="CONTENT_TYPE_ID"
 *     data-template="list"
 *     data-target="cms-content"
 *     data-limit="5"
 *   ></script>
 *   <div id="cms-content"></div>
 *
 * スクリプトタグの属性:
 *   data-content-type (必須): コンテンツタイプ ID
 *   data-template     (必須): テンプレート shortname
 *   data-target              : コンテンツを挿入する要素の id（省略時: "cms-content"）
 *   data-limit               : 取得件数（省略時: 5）
 *   data-page                : ページ番号（省略時: 1）
 *   data-sort                : ソート順 desc|asc（省略時: desc）
 *   data-sort-by             : ソートキー（省略時: createdAt）
 *   data-flag0〜data-flag9   : フラグフィルタ（0/1）
 *   data-text0〜data-text9   : テキスト完全一致フィルタ
 *
 * why: src 属性から自分の URL のオリジンを取得することで、
 *      embed.js を CloudFront 経由で配信した場合も
 *      正しいオリジンの /render を呼び出せる。
 *      currentScript が使えないブラウザ（IE11 等）は対象外とし、
 *      フォールバックも記述しない（IE11 サポートは blueprint 外）。
 */
function buildEmbedScript(siteId: string, serverOrigin: string): string {
  // siteId を JS 文字列リテラルとして安全に埋め込む
  // why: isSafeId で /^[a-zA-Z0-9_-]{1,100}$/ を検証済みなので
  //      JSON.stringify の二重エスケープは不要だが念のため使用する
  const safeSiteId = JSON.stringify(siteId);

  return `/* newcleus embed.js – auto-generated */
(function () {
  'use strict';

  var SITE_ID = ${safeSiteId};

  // スクリプト要素を取得する
  // why: document.currentScript は ES2015 の標準であり、主要ブラウザでサポートされている
  var scriptEl = document.currentScript;
  if (!scriptEl) {
    console.error('[newcleus] embed.js: スクリプト要素を取得できませんでした');
    return;
  }

  // スクリプト URL のオリジンを取得する
  // why: スクリプトが CloudFront 経由で配信された場合も、
  //      同じオリジンの /render を呼び出せるようにする
  var scriptSrc = scriptEl.src || '';
  var scriptOrigin = '';
  try {
    scriptOrigin = new URL(scriptSrc).origin;
  } catch (e) {
    // URL パース失敗時はサーバーサイドのオリジンにフォールバック
    scriptOrigin = ${JSON.stringify(serverOrigin)};
  }

  // data 属性からパラメータを取得する
  function attr(name, def) {
    var val = scriptEl.getAttribute('data-' + name);
    return (val !== null && val !== '') ? val : def;
  }

  var contentType = attr('content-type', '');
  var template    = attr('template', '');
  // コンテンツ挿入先要素の ID を保持しておく（取得は fetch 完了後に行う）
  // why: script タグが div より先に HTML に記述された場合、
  //      スクリプト実行時点では div がまだ DOM に存在しないため、
  //      getElementById を同期実行すると null になる。
  //      fetch の非同期コールバック内で取得することで確実に見つかる。
  var targetId    = attr('target', 'cms-content');
  var limit       = attr('limit', '5');
  var page        = attr('page', '1');
  var sort        = attr('sort', 'desc');
  var sortBy      = attr('sort-by', 'createdAt');

  // 必須パラメータチェック
  if (!contentType) {
    console.error('[newcleus] embed.js: data-content-type が指定されていません');
    return;
  }
  if (!template) {
    console.error('[newcleus] embed.js: data-template が指定されていません');
    return;
  }

  // /render へのクエリパラメータを構築する
  var params = new URLSearchParams();
  params.set('contentType', contentType);
  params.set('template', template);
  params.set('limit', limit);
  params.set('page', page);
  params.set('sort', sort);
  params.set('sort_by', sortBy);

  // フラグフィルタ (data-flag0〜data-flag9)
  for (var i = 0; i < 10; i++) {
    var flagVal = attr('flag' + i, null);
    if (flagVal !== null) {
      params.set('flag' + i, flagVal);
    }
  }

  // テキストフィルタ (data-text0〜data-text9)
  for (var j = 0; j < 10; j++) {
    var textVal = attr('text' + j, null);
    if (textVal !== null) {
      params.set('text' + j, textVal);
    }
  }

  var renderUrl = scriptOrigin + '/api/v1/sites/' + SITE_ID + '/render?' + params.toString();

  fetch(renderUrl)
    .then(function (res) {
      if (!res.ok) {
        console.error('[newcleus] embed.js: /render から ' + res.status + ' が返されました', renderUrl);
        return '';
      }
      return res.text();
    })
    .then(function (html) {
      // 空文字列または空白のみの場合は何もしない（0 件の場合など）
      if (!html || !html.trim()) return;

      // why: getElementById はここで呼ぶ。
      //      同期実行時点では div がまだ DOM に存在しない場合があるため
      //      （script タグより後に div を書いた場合など）、
      //      非同期コールバック内で取得することで確実に見つかる。
      var targetEl = document.getElementById(targetId);
      if (!targetEl) {
        console.error('[newcleus] embed.js: 要素 #' + targetId + ' が見つかりません');
        return;
      }

      targetEl.innerHTML = html;

      // why: innerHTML でセットされた <script> タグはブラウザが実行しない仕様のため、
      //      手動で同等の script 要素を生成・挿入することで JS を実行させる。
      //      テンプレート内のモーダル開閉 JS 等を動作させるために必要。
      var scripts = targetEl.querySelectorAll('script');
      for (var k = 0; k < scripts.length; k++) {
        var orig = scripts[k];
        var copy = document.createElement('script');
        if (orig.src) {
          copy.src = orig.src;
          copy.async = false;
        } else {
          copy.textContent = orig.textContent;
        }
        // 元の script 要素を置き換えて実行させる
        orig.parentNode.replaceChild(copy, orig);
      }
    })
    .catch(function (err) {
      console.error('[newcleus] embed.js: fetch エラー:', err && err.message ? err.message : err);
    });
})();
`;
}
