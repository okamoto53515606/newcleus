#!/usr/bin/env bash
# セットアップ画面（http://localhost:3001）の起動スクリプト。
# 配布 WSL では `wsl -d newcleus -u ubuntu -- bash -i /home/ubuntu/newcleus/setup/start.sh`
# の形で呼ばれる。
#
# why: 以前は /home/ubuntu/newcleus を直接書いていたが、配布先（~ = /home/ubuntu）と
#      開発サンドボックスで配置が異なり、同じファイルを使い回せなかった。
#      自分の位置から setup ディレクトリを解決することで 1 本で両対応にする。
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# why: WSL2 の DNS 設定が不正な状態になると git / AWS API 呼び出しが失敗する。
#      応急処置として resolv.conf を 8.8.8.8 に書き換える。
#      sudo がパスワード無しで通る配布イメージでのみ実行し、失敗しても起動は止めない
#      （社内 DNS を使う環境で固定値を強制しないため）。
if sudo -n true 2>/dev/null; then
  echo 'nameserver 8.8.8.8' | sudo -n tee /etc/resolv.conf >/dev/null 2>&1 || true
fi

# why: dev (Turbopack) は初回コンパイルが重く、低スペック環境で固まりやすい。
#      build 済み成果物を next start で配信することで起動を一瞬にする。
# why: nvm の node/npm は ~/.bashrc で PATH に入るため、先に読み込む。
source "${HOME}/.bashrc" 2>/dev/null || true
cd "${SCRIPT_DIR}" || exit 1
npm run start
