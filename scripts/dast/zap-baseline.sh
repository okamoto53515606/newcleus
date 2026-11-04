#!/usr/bin/env bash
# why:
#   週次で回す「受動スキャン」。攻撃ペイロードを一切送らないため本番に対して安全で、
#   セキュリティヘッダ欠落・Cookie 属性・情報漏洩・既知の混入パターンを検出する。
#   Active Scan と違い副作用が無いので、テスト環境が無い本番直叩き運用の基準線になる。
#
# 使い方:
#   ./scripts/dast/zap-baseline.sh
#   TARGET_BASE=https://example.com ./scripts/dast/zap-baseline.sh
#
# 出力:
#   zap-reports/baseline-report.html / baseline-report.json   (.gitignore 済み)

set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

echo "[baseline] target=${TARGET_BASE}" >&2

# -m 5 : Spider/受動スキャンの上限 5 分。production なので短く打ち切る。
# -I  : WARN では非ゼロ終了しない（CI 判定は summarize.mjs の重要度集計で行う）。
set +e
zap_run zap-baseline.py \
  -t "${TARGET_BASE}/" \
  -c zap.conf \
  -r baseline-report.html \
  -J baseline-report.json \
  -m 5 \
  -I
rc=$?
set -e

echo "[baseline] zap exit=${rc}" >&2
echo "[baseline] レポート: zap-reports/baseline-report.html" >&2
exit 0
