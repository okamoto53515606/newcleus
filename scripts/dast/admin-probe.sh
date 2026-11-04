#!/usr/bin/env bash
# why:
#   管理画面・管理 API を「未認証の攻撃者」の立場で叩き、認可が漏れていないかを
#   アサーション方式で確認する。
#
#   なぜ ZAP ではなく自作なのか:
#     ZAP の Active Scan は「入力によってレスポンスがどう変わるか」で脆弱性を判定する。
#     未認証アクセスは常に 307/401 を返すため差分が出ず、認可漏れがあっても
#     検出できないことが多い。一方この検査は「期待するステータスコード」を
#     宣言して比較するだけで済み、検出力が明確で CI の合否判定にも使える。
#
#   本番に対して実行するうえでの安全策:
#     書き込み系エンドポイントは **不正なボディ**（{} や空）で叩く。
#     万一認可が破られていてもバリデーションで 400 になり、DB は変化しない。
#     DELETE はクエリ文字列のみ（CloudFront が DELETE の body を転送しないため）。
#
# 判定:
#   PASS : 期待どおり 401（未認証を正しく拒否）
#   WARN : 403 / 405 など「拒否はしているがステータスが不整合」
#          → 認可漏れではないが、監視・クライアント実装の観点で直すべき
#   FAIL : 200 系（データ返却 or 認可バイパスの疑い）
#
# 使い方:
#   ./scripts/dast/admin-probe.sh

set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# why: 認可プローブが見たいのは「未認証で弾かれるか」だけで、テナントの実在性は
#      関係ない（認証判定は ID の参照より前に行われる）。実在する ID を
#      公開リポジトリに固定しないため、未指定時はダミー ID を使う。
SITE_ID="${PROBE_SITE_ID}"
CONTENT_TYPE="${PROBE_CT_ID}"

PASS=0
WARN=0
FAIL=0
WARNINGS=()
FAILURES=()

CURL=(curl -sS --max-time 20 -o /tmp/dast-probe-body -w '%{http_code}')

# 管理 API: 期待 = 401
probe_api() {
  local method="$1" path="$2" body="${3:-}"
  local args=(-X "${method}")
  if [[ -n "${body}" ]]; then
    # why: CloudFront OAC は「実際のボディの SHA256」と x-amz-content-sha256 が
    #      一致しないリクエストをエッジで 403 にする。アプリの認可判定まで
    #      到達させたいので、実クライアント（fetchWithSigning）と同じヘッダを付ける。
    #      これを付けないと「アプリが 401 を返した」のか「エッジが弾いた」のか
    #      区別できず、認可の検査にならない。
    local hash
    hash="$(printf '%s' "${body}" | sha256sum | cut -d' ' -f1)"
    args+=(-H 'Content-Type: application/json' -H "x-amz-content-sha256: ${hash}" --data "${body}")
  fi

  local code
  code="$("${CURL[@]}" "${args[@]}" "${TARGET_BASE}${path}" || echo "000")"

  case "${code}" in
    401) PASS=$((PASS + 1)); printf '  PASS  %-6s %-64s %s\n' "${method}" "${path}" "${code}" ;;
    403|405)
      WARN=$((WARN + 1))
      WARNINGS+=("${method} ${path} -> ${code}（401 であるべき）")
      printf '  WARN  %-6s %-64s %s\n' "${method}" "${path}" "${code}" ;;
    *)
      FAIL=$((FAIL + 1))
      FAILURES+=("${method} ${path} -> ${code}")
      printf '  FAIL  %-6s %-64s %s  ← 認可漏れの疑い\n' "${method}" "${path}" "${code}"
      head -c 200 /tmp/dast-probe-body; echo ;;
  esac
}

# 管理ページ: 期待 = ログインへリダイレクト（30x）
probe_page() {
  local path="$1"
  local code
  code="$("${CURL[@]}" "${TARGET_BASE}${path}" || echo "000")"
  if [[ "${code}" =~ ^30[2378]$ ]]; then
    PASS=$((PASS + 1)); printf '  PASS  %-6s %-64s %s\n' "GET" "${path}" "${code}"
  else
    FAIL=$((FAIL + 1))
    FAILURES+=("GET ${path} -> ${code}（未認証で管理ページ本文が返った）")
    printf '  FAIL  %-6s %-64s %s  ← 未認証で本文が返却\n' "GET" "${path}" "${code}"
  fi
}

echo "== 管理ページ（未認証でリダイレクトされるべき） =="
probe_page "/admin"
probe_page "/admin/sites"
probe_page "/admin/tenants"
probe_page "/admin/sites/new"

echo
echo "== 管理 API（未認証で 401 であるべき） =="
probe_api GET  "/api/admin/auth/me"
probe_api GET  "/api/admin/sites"
probe_api GET  "/api/admin/tenants"
probe_api GET  "/api/admin/sites/${SITE_ID}"
probe_api GET  "/api/admin/sites/${SITE_ID}/items"
probe_api GET  "/api/admin/sites/${SITE_ID}/items/00000000000000000000"
probe_api GET  "/api/admin/sites/${SITE_ID}/content-types"
probe_api GET  "/api/admin/sites/${SITE_ID}/content-types/${CONTENT_TYPE}"
probe_api GET  "/api/admin/sites/${SITE_ID}/content-types/${CONTENT_TYPE}/templates"
probe_api GET  "/api/admin/sites/${SITE_ID}/content-types/${CONTENT_TYPE}/templates/00000000000000000000"

echo
echo "== 書き込み系（不正ボディで叩くので、通っても DB は変化しない） =="
probe_api POST   "/api/admin/sites"                                                        "{}"
probe_api PUT    "/api/admin/sites/${SITE_ID}"                                             "{}"
probe_api DELETE "/api/admin/sites/${SITE_ID}?probe=1"
probe_api POST   "/api/admin/preview"                                                      "{}"
probe_api POST   "/api/admin/upload"

echo
echo "== フレームワーク既知のバイパス手法 =="
# why: Next.js には x-middleware-subrequest で middleware をスキップできる脆弱性
#      (CVE-2025-29927) があった。本アプリは middleware 未使用で該当しないが、
#      「該当しないこと」を継続的に確認しておく価値があるためテストに残す。
_headers="$(curl -sS -D - -o /dev/null --max-time 20 -H 'x-middleware-subrequest: middleware:middleware:middleware:middleware:middleware' "${TARGET_BASE}/admin/sites" || true)"
_mw_code="$(printf '%s' "${_headers}" | awk 'NR==1{print $2}')"
if [[ "${_mw_code}" =~ ^30[2378]$ ]]; then
  PASS=$((PASS + 1)); echo "  PASS  x-middleware-subrequest bypass -> ${_mw_code}"
else
  FAIL=$((FAIL + 1)); FAILURES+=("x-middleware-subrequest bypass -> ${_mw_code}")
  echo "  FAIL  x-middleware-subrequest bypass -> ${_mw_code}"
fi

# パス正規化による /admin 回避
#   30x: ログインへ飛ばされた / 400,403,404: 経路として拒否された のいずれも「突破できていない」
for p in "/admin/%2e%2e/sites" "/sites/..%2f..%2fadmin/sites" "//admin/sites"; do
  code="$("${CURL[@]}" "${TARGET_BASE}${p}" || echo "000")"
  if [[ "${code}" =~ ^30[2378]$ || "${code}" =~ ^(400|403|404)$ ]]; then
    PASS=$((PASS + 1)); printf '  PASS  %-6s %-64s %s\n' "GET" "${p}" "${code}"
  else
    FAIL=$((FAIL + 1)); FAILURES+=("GET ${p} -> ${code}")
    printf '  FAIL  %-6s %-64s %s\n' "GET" "${p}" "${code}"
  fi
done

echo
echo "== セキュリティヘッダ（公開トップ） =="
_resp="$(curl -sS -D - -o /dev/null --max-time 20 "${TARGET_BASE}/" || true)"
check_header() {
  local name="$1" want="$2" required="$3"
  local line
  # why: || true が無いと、ヘッダが存在しない場合に grep の exit 1 が pipefail +
  #      set -e に拾われてスクリプト全体が途中終了する（実際に踏んだ）。
  line="$(printf '%s' "${_resp}" | grep -i "^${name}:" | head -1 | tr -d '\r' || true)"
  if [[ -z "${line}" ]]; then
    if [[ "${required}" == "required" ]]; then
      FAIL=$((FAIL + 1)); FAILURES+=("ヘッダ欠落: ${name}")
      echo "  FAIL  ${name} 欠落"
    else
      WARN=$((WARN + 1)); WARNINGS+=("ヘッダ欠落（推奨）: ${name}")
      echo "  WARN  ${name} 欠落（推奨）"
    fi
    return
  fi
  if [[ -n "${want}" && "${line,,}" != *"${want,,}"* ]]; then
    WARN=$((WARN + 1)); WARNINGS+=("${name} の値が想定外: ${line}")
    echo "  WARN  ${line}"
  else
    PASS=$((PASS + 1)); echo "  PASS  ${line}"
  fi
}
# why: HSTS / nosniff / Referrer-Policy は CloudFront の ResponseHeadersPolicy が付与する。
#      ローカル（next dev）で実行すると必ず「欠落」になるため、環境依存の誤検知を避けて省略する。
if [[ "${TARGET_BASE}" =~ ^http://(localhost|127\.0\.0\.1) ]]; then
  echo "  SKIP  ローカル実行のためエッジ側ヘッダの検査を省略（CloudFront が付与）"
else
  check_header "strict-transport-security" "max-age"        required
  check_header "x-content-type-options"    "nosniff"        required
  check_header "referrer-policy"           ""               required
  check_header "content-security-policy"   ""               optional
  check_header "x-frame-options"           ""               optional
fi

# x-powered-by はフレームワーク種別を晒すため非推奨（next.config.ts の poweredByHeader: false）
if printf '%s' "${_resp}" | grep -qi '^x-powered-by:'; then
  WARN=$((WARN + 1)); WARNINGS+=("x-powered-by が有効（フレームワーク種別を開示）")
  echo "  WARN  x-powered-by が返っている"
else
  PASS=$((PASS + 1)); echo "  PASS  x-powered-by なし"
fi

echo
echo "== 情報漏洩（source map / 管理画面キャッシュ） =="
_home="$(curl -sS --max-time 20 "${TARGET_BASE}/" || true)"
_chunk="$(printf '%s' "${_home}" | grep -oE '/_next/static/[^"]+\.js' | head -1 || true)"
if [[ -n "${_chunk}" ]]; then
  _js="$(curl -sS --max-time 20 "${TARGET_BASE}${_chunk}" || true)"
  if printf '%s' "${_js}" | grep -q 'sourceMappingURL='; then
    WARN=$((WARN + 1)); WARNINGS+=("クライアントJSに sourceMappingURL が含まれる")
    echo "  WARN  ${_chunk} に sourceMappingURL あり"
  else
    PASS=$((PASS + 1)); echo "  PASS  sourceMappingURL なし"
  fi
else
  echo "  SKIP  クライアントチャンクを抽出できませんでした"
fi

_login_cache="$(curl -sS -D - -o /dev/null --max-time 20 "${TARGET_BASE}/admin/login" | grep -i '^cache-control:' | tr -d '\r' || true)"
if printf '%s' "${_login_cache}" | grep -qi 'no-store'; then
  PASS=$((PASS + 1)); echo "  PASS  /admin/login は ${_login_cache}"
else
  WARN=$((WARN + 1)); WARNINGS+=("管理画面がキャッシュ可能: ${_login_cache:-ヘッダなし}")
  echo "  WARN  /admin/login の Cache-Control: ${_login_cache:-なし}"
fi

echo
echo "== レート制限（/admin/login に 10 連続リクエスト） =="
# why: WAF のレート制限やブルートフォース対策が無い場合、ログイン試行を無制限に
#      繰り返せる。Cognito 側の保護に依存している状態かを可視化する。
_codes=""
for _i in $(seq 1 10); do
  _c="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "${TARGET_BASE}/admin/login" || echo 000)"
  _codes="${_codes}${_c} "
done
echo "  codes: ${_codes}"
if printf '%s' "${_codes}" | grep -qE '\b(429|403)\b'; then
  PASS=$((PASS + 1)); echo "  PASS  レート制限が働いている"
else
  WARN=$((WARN + 1)); WARNINGS+=("レート制限なし（/admin/login が 10 連続で応答）")
  echo "  WARN  レート制限は検出されず（CloudFront/WAF 側で未設定の可能性）"
fi

echo
echo "================ 結果 ================"
echo "PASS=${PASS}  WARN=${WARN}  FAIL=${FAIL}"
if (( ${#WARNINGS[@]} > 0 )); then
  echo "--- WARN ---"
  printf ' - %s\n' "${WARNINGS[@]}"
fi
if (( ${#FAILURES[@]} > 0 )); then
  echo "--- FAIL ---"
  printf ' - %s\n' "${FAILURES[@]}"
fi

(( FAIL == 0 )) || exit 1
