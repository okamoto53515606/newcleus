#!/usr/bin/env bash
# why:
#   Baseline / API Scan / Full Scan で共通の「対象解決・レポート出力先・docker 起動」を
#   1か所に集約する。スクリプトごとに TARGET の既定値やマウント方法がずれると、
#   「どのレポートがどの環境を叩いた結果か」が追えなくなり、修正→再スキャンの
#   比較ができなくなるため。
#
# 方針:
#   - .env は「値の読み取り」だけ行い、source しない。
#     why: source すると AWS の長期クレデンシャルまで ZAP コンテナへ環境変数として
#          渡ってしまう。DAST は未認証で叩く前提なので、認証情報は一切不要。
#   - 既定の対象は本番 (CloudFront)。誤って別環境を叩かないよう TARGET_BASE は
#     明示上書きのみ受け付ける（環境変数が空なら .env の CLOUDFRONT_DOMAIN を使う）。

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPORT_DIR="${REPO_ROOT}/zap-reports"
ZAP_IMAGE="${ZAP_IMAGE:-zaproxy/zap-stable}"

# .env から単一キーだけを読む（source しない）
# why: クレデンシャルを子プロセスに漏らさないため。値の前後のダブルクォートのみ剥がす。
env_get() {
  local key="$1"
  [[ -f "${REPO_ROOT}/.env" ]] || return 0
  grep -E "^${key}=" "${REPO_ROOT}/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"'
}

# 対象オリジン（末尾スラッシュなし）
if [[ -z "${TARGET_BASE:-}" ]]; then
  _domain="$(env_get CLOUDFRONT_DOMAIN)"
  if [[ -z "${_domain}" ]]; then
    echo "[dast] CLOUDFRONT_DOMAIN が .env に見つかりません。TARGET_BASE を明示してください" >&2
    exit 1
  fi
  TARGET_BASE="https://${_domain}"
fi
TARGET_BASE="${TARGET_BASE%/}"

# スキャン対象テナント
#   why: SITE_ID / CONTENT_TYPE をリポジトリに固定しない（公開リポジトリのため）。
#        実値は環境変数で渡し、未指定時のみ既定のテストサイトを使う。
SITE_ID="${SITE_ID:-9ada961d5d288cba3742}"
CONTENT_TYPE="${CONTENT_TYPE:-04b81d1e8d08c51449f0}"

mkdir -p "${REPORT_DIR}"

# ZAP コンテナ起動ラッパー
# why:
#   - zap-baseline.py は作業ファイル (zap.yaml / session / レポート) を **/zap/wrk 固定**で
#     書き出す実装になっている（`base_dir = '/zap/wrk/'`）。そのため /zap/wrk は
#     書き込み可能なマウントでなければならず、後から -w で変えることはできない。
#   - リポジトリ全体をマウントすると .env（AWS キー）がサードパーティイメージから
#     見える状態になる。そこで「zap-reports だけを /zap/wrk にマウント」し、
#     設定ファイルは起動前に zap-reports へコピーする方式にする。
#   - -u でホストの uid:gid を合わせ、生成物が root 所有にならないようにする
#     （ZAP イメージの既定ユーザーも uid=1000 のため一致する）。
zap_run() {
  local f
  for f in zap.conf openapi.public.yaml; do
    [[ -f "${REPO_ROOT}/scripts/dast/${f}" ]] && cp "${REPO_ROOT}/scripts/dast/${f}" "${REPORT_DIR}/${f}"
  done

  # why: レポートはコンテナ内 /zap/wrk からの相対パスで指定する必要があるため、
  #      引数側では `-r baseline-report.html` のようにファイル名だけを渡す。
  docker run --rm \
    -u "$(id -u):$(id -g)" \
    -v "${REPORT_DIR}:/zap/wrk:rw" \
    "${ZAP_IMAGE}" "$@"
}
