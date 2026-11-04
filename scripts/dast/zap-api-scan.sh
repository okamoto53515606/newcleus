#!/usr/bin/env bash
# why:
#   公開 API (/api/v1) に対してだけ Active Scan をかける。
#   Full Scan と違い UI をクロールしないため、対象が「GET のみの読み取り API」に
#   限定され、本番 DB への書き込みが構造的に発生しない。
#
#   管理 API はここに含めない:
#     未認証では 401 しか返らず Active Scan の検出力がほぼ無いため。
#     認可の確認は admin-probe.sh のアサーションで行う。
#
# 使い方:
#   SITE_ID=xxx CONTENT_TYPE=yyy ./scripts/dast/zap-api-scan.sh
#
# 出力:
#   zap-reports/api-scan-report.html / api-scan-report.json

set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SPEC_OUT="${REPORT_DIR}/openapi.generated.yaml"

# why: テナント ID を公開リポジトリの YAML に固定しないため、実行時に実値へ置換する。
#      sed の区切りは | （URL に / が含まれるため）。
sed -e "s|__TARGET_BASE__|${TARGET_BASE}|g" \
    -e "s|__SITE_ID__|${SITE_ID}|g" \
    -e "s|__CONTENT_TYPE__|${CONTENT_TYPE}|g" \
    "$(dirname "${BASH_SOURCE[0]}")/openapi.public.yaml" > "${SPEC_OUT}"

echo "[api-scan] target=${TARGET_BASE} siteId=${SITE_ID} contentType=${CONTENT_TYPE}" >&2

# -T 30 : Active Scan の上限 30 分。本番の Lambda 同時実行を守るため必ず打ち切る。
set +e
zap_run zap-api-scan.py \
  -t openapi.generated.yaml \
  -f openapi \
  -O "${TARGET_BASE}" \
  -c zap.conf \
  -r api-scan-report.html \
  -J api-scan-report.json \
  -T 30 \
  -I
rc=$?
set -e

echo "[api-scan] zap exit=${rc}" >&2
echo "[api-scan] レポート: zap-reports/api-scan-report.html" >&2
exit 0
