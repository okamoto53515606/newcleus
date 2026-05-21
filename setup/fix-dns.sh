#!/usr/bin/env bash
# why: WSL2 の /etc/resolv.conf が自動生成する nameserver (通常 172.x.x.x) は
#      ホスト側の DNS 設定次第で名前解決が不安定になることがある。
#      8.8.8.8 (Google Public DNS) に強制上書きすることで安定した名前解決を保証する。
#      /etc/resolv.conf は WSL 起動のたびに上書きされる場合があるため、
#      必要に応じてこのスクリプトを再実行する。

set -e

echo "nameserver 8.8.8.8" | sudo tee /etc/resolv.conf > /dev/null
echo "DNS updated: $(cat /etc/resolv.conf)"
