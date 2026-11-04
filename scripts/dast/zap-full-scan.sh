#!/usr/bin/env bash
# why:
#   四半期に一度、UI 全体（RSC / 静的アセット / 公開ページ）を Spider + Active Scan する。
#   API Scan では拾えない HTML フォーム・リンク経由・ヘッダインジェクションを検出する。
#
#   本番直叩きのため以下を必須のガードレールとする:
#     -m 10 : Spider を 10 分で打ち切る
#     -T 60 : Active Scan を 60 分で打ち切る
#   実行後は必ず CloudFront の invalidation を行う（クエリバリアントのキャッシュ汚染）。
#
# 使い方:
#   ./scripts/dast/zap-full-scan.sh
#
# 出力:
#   zap-reports/full-scan-report.html / full-scan-report.json

set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

echo "[full-scan] target=${TARGET_BASE}" >&2
echo "[full-scan] 注意: 本番に対する能動スキャンです。負荷とキャッシュ汚染を許容できる時間帯に実行してください" >&2

set +e
zap_run zap-full-scan.py \
  -t "${TARGET_BASE}/" \
  -c zap.conf \
  -r full-scan-report.html \
  -J full-scan-report.json \
  -m 10 \
  -T 60 \
  -I
rc=$?
set -e

echo "[full-scan] zap exit=${rc}" >&2
echo "[full-scan] レポート: zap-reports/full-scan-report.html" >&2
echo "[full-scan] 次の手順: CloudFront の invalidation を実行してください（docs/security/dast.md 参照）" >&2
exit 0
