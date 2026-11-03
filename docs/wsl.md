# 配布用 WSL イメージの作成メモ

> **why:** 一般ユーザーが `newcleus` をローカルでセットアップできるよう、必要なツール（Node.js / Docker / AWS CLI / プロジェクトコード）を全部入りで構成済みの WSL イメージを GitHub Releases で配布する。受け取り側は `wsl --import` するだけで、`http://localhost:3001` のセットアップ画面に進める状態を作る。

## 前提

- **Windows 11**（`wsl --install` がワンコマンドで Ubuntu 導入できるバージョン）。Windows 10 はサポート対象外。
- インストール後の Ubuntu はクリーンな状態から構築し、`git clone`（`tar -xz`）以外のソースを混入させない。これにより配布物に個人情報が混入しない（リポジトリは public で個人情報なし、`.env` は `env_template.txt` のコピーのみ）。

## 全体フロー

1. **Windows**: クリーンな Ubuntu WSL を作成
2. **WSL (Ubuntu)**: 必要ツール導入 → 環境チェック → リポジトリ取得 + ビルド（`fetch-app.sh`）→ 起動スクリプトの確認
3. **Windows**: `wsl --export` で tar 化
4. **WSL**: tar を pigz で圧縮 + sha256 算出
5. **Windows**: `gh release create` で GitHub Release にアップロード

各ステップでコマンドの実行場所が **Windows (PowerShell)** か **WSL (Ubuntu)** かを明示する。

---

## 1. WSL ディストリビューション作成 (Windows)

PowerShell を**管理者権限**で起動。

```powershell
wsl --install
# ダウンロード中: Ubuntu
# インストール中: Ubuntu
# ディストリビューションが正常にインストールされました。'wsl.exe -d Ubuntu' を使用して起動できます
```

> 既に Ubuntu が入っている場合は `wsl --unregister Ubuntu` で破棄してから再 install すること（クリーンな状態でイメージを作るため）。

```powershell
wsl.exe -d Ubuntu
```

初回起動時に Unix ユーザー作成を求められる:

```text
Create a default Unix user account: ubuntu
New password: ********
Retype new password: ********
passwd: password updated successfully
```

> **why:** ユーザー名を `ubuntu` 固定にするのは、配布後の起動コマンド `wsl -d Ubuntu -u ubuntu -- bash -i /home/ubuntu/newcleus/setup/start.sh` を全環境で同じパスで動かすため。

---

## 2. sudo を NOPASSWD 化 (WSL)

WSL 上で:

```bash
sudo visudo
```

末尾に追記:

```text
%sudo   ALL=(ALL:ALL) ALL
ubuntu  ALL=(ALL) NOPASSWD: ALL
```

`Ctrl+O` → `Enter` で保存、`Ctrl+X` で終了。

> **why:** 配布後ユーザーが setup 画面から内部的に sudo を呼ぶため、対話式パスワード入力で詰まらないようにする。

一旦抜ける:

```bash
exit
```

---

## 3. ベースツール導入 (WSL)

```bash
wsl.exe -d Ubuntu      # Windows 側で再起動
```

```bash
cd ~
sudo apt-get -y install zip
```

### AWS CLI v2

```bash
# why: setup 画面が aws CLI / SDK のクレデンシャル参照を前提にしている
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install
aws --version   # aws-cli/2.x.x ...
```

### Node.js (nvm 経由で Node 24)

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash
source ~/.bashrc
nvm --version
nvm install 24
nvm use 24
nvm alias default 24
```

> **why:** Node.js 20 は 2026-04-30 に EOL。CVE-2026-111497（Brotli decoder の
> out-of-bounds write）は Node 22.23.4 / 24.22.1 / 26.12.1 で修正された。
> 24 系の最新パッチを追従するため `nvm install 24` で LTS を導入し、
> 24.22.1 以上であることを前提にする。

### apt 全体更新 + 開発ツール

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y apt-transport-https ca-certificates curl software-properties-common \
  git unzip build-essential python3 make gcc
```

### Docker (CDK / Lambda コンテナビルドで必須)

```bash
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io
sudo usermod -aG docker $USER
newgrp docker

# 動作確認
docker run hello-world
sudo systemctl enable docker
```

> **why:** `npx cdk deploy` 時に Lambda コンテナイメージを Docker でビルドする。Docker daemon が起動している必要があるので、`systemctl enable` で次回 WSL 起動時に自動起動させる。

---

## 4. ディスク・ネットワーク最適化（配布前のスリム化） (WSL)

エクスポート前に行う「配布イメージを軽くする」掃除工程。`wsl --import` 後に手元で動かすだけなら省略可だが、**Release に上げる前の最終工程としては必須**。

### 4-2. プリインストールパッケージの削除

WSL 環境では不要な常駐デーモン（snapd, cloud-init 等）をパージする。Server 用途を想定したクラウド系ツールは WSL では動作しない or 起動時間を伸ばすだけで、配布物として邪魔になるため削除。

```bash
# snapd, cloud-init, その他WSLでは不要なツールを削除
sudo apt-get purge -y \
  snapd \
  unattended-upgrades \
  ubuntu-advantage-tools \
  cloud-init \
  landscape-common \
  command-not-found

# 不要になった依存関係のクリーンアップ
sudo apt-get autoremove --purge -y
```

> **why:** `snapd` は WSL でカーネル依存により正常動作せずディスクだけ食う。`cloud-init` / `landscape-common` / `ubuntu-advantage-tools` はクラウド/Canonical サポート用で、本配布物では一切使わない。`unattended-upgrades` は配布後に勝手にパッケージ更新が走ると再現性が壊れるので除去する。

### 4-3. Docker / npm キャッシュの削除

開発中に積み上がったビルドキャッシュ・未使用イメージを完全に消す。インストール直後で何もなければスキップ可。

```bash
# Dockerのビルドキャッシュや未使用イメージを完全に削除
docker system prune -a --volumes -f

# npm のキャッシュ削除
npm cache clean --force
```

> **why:** Docker のビルドキャッシュは数 GB 単位で残ることがあり、tar.gz 圧縮後でも配布サイズに大きく効く。エクスポート直前にだけ走らせる。

### 4-4. システムログ・ドキュメント・ロケールの削除

エクスポートサイズを最小化するための最後の絞り込み。

```bash
# aptのパッケージリスト(インデックス)を削除（数百MB単位で効く）
sudo rm -rf /var/lib/apt/lists/*

# ダウンロード済みのパッケージアーカイブ(.deb)を削除
sudo apt-get clean

# 多言語ドキュメント・man ページの削除（copyright だけ法的に残す）
sudo find /usr/share/doc -depth -type f ! -name copyright -delete
sudo find /usr/share/man -type f -delete

# why: en/ja 以外のロケールファイルは不要。数百 MB 削減できる。
sudo find /usr/share/locale -mindepth 1 -maxdepth 1 -type d \
  ! -name 'en*' ! -name 'ja*' ! -name 'locale.alias' ! -name 'C.UTF-8' \
  -exec rm -rf {} +

# why: snapd purge 後もデータディレクトリが残留することがある。
sudo rm -rf /var/lib/snapd /var/cache/snapd /snap

# テンポラリファイルとログのクリア
sudo rm -rf /tmp/*
sudo rm -rf /var/tmp/*
sudo find /var/log -type f -exec cp /dev/null {} \;
```

> **why:** `/var/lib/apt/lists` と `/usr/share/doc` `/usr/share/man` は合計で数百 MB〜1GB 規模を占める。配布物では再度 `apt-get update` を走らせれば apt インデックスは復旧するため安全に消せる。`copyright` ファイルだけは GPL 等のライセンス義務で残す。ログは `cp /dev/null` で **inode を保持したまま中身だけ空に** することで、journald 等の書き込み先 fd を壊さない。

---

## 5. 環境チェック (WSL)

すべてバージョンが出ること、Docker daemon が OK であることを確認。`fetch-app.sh` は Node 24 系を前提にする。

```bash
echo "=== versions ===" && \
node -v && npm -v && \
aws --version && \
docker --version && (docker info >/dev/null 2>&1 && echo "docker daemon: OK" || echo "docker daemon: NG") ; \
git --version && \
make --version | head -1 && \
gcc --version | head -1 && \
python3 --version && \
curl --version | head -1 && \
unzip -v | head -1
```

---

## 6. リポジトリ取得 & ビルド (WSL)

取得・不要ファイルの除去・`.env` 作成・依存インストール・`setup` のビルド・prune は
[setup/scripts/fetch-app.sh](../setup/scripts/fetch-app.sh) に集約している。イメージ作成では `--fresh --dist` で実行する。

```bash
# why: 手元のスクリプトに依存すると、修正済みの挙動（退避・引き継ぎ・ビルド検証）が効かない。
#      必ず main から最新を取得し、取得に失敗したらそこで止める（古いもので続行しない）。
(
  set -euo pipefail
  curl -fsSL --retry 3 -o /tmp/fetch-app.sh \
    https://raw.githubusercontent.com/okamoto53515606/newcleus/main/setup/scripts/fetch-app.sh
  bash -n /tmp/fetch-app.sh   # 壊れたファイル/別物を掴んでいないか構文チェック

  # --fresh: .env を env_template.txt から作る（初回セットアップ用）
  # --dist : setup を npm install → next build し、devDependencies を prune --production する
  bash /tmp/fetch-app.sh --dir "$HOME/newcleus" --fresh --dist
)
```

> **why:** 配布後の初回起動を高速化するため、`npm install` と setup の `next build` を配布側で済ませて `node_modules` / `.next` ごとイメージに固める。
> ルート (`~/newcleus`) は CDK 用依存だけが必要 (`aws-cdk-lib`, `@types/node` 等)。Next.js 本体の build はランタイムでは Lambda コンテナビルド経由で行うため不要。

> **注意:** `--fresh` は `.env` を `env_template.txt` から作り直す。AWS キー等を入力済みの環境では使わない（既存環境の更新は `--update --build`）。

> **スクリプトが行うこと:** ダウンロード → レイアウト検証（`package.json` / `setup` / `env_template.txt`）→ `prompt_history`・`test` の除去 → 旧ツリーの退避 → `.env` / `setup/setup-state.json` の引き継ぎ → `npm install` → `setup` の `next build` → `setup/.next/BUILD_ID` の存在確認。途中で失敗しても既存ツリーは退避されるまで触らない。

> **バージョンの確認:** 焼き込まれたアプリのバージョンは `~/newcleus/package.json` の `version`。セットアップ画面自体にはバージョン表記が無いため、出荷前に `setup/.next/BUILD_ID` の日時と `package.json` の `version` を突き合わせる。**バージョンを上げたら必ず setup を再ビルドしてから export する** こと（build 済み `.next` を使い回すと画面だけ古いまま残る）。

---

## 7. 起動スクリプト (WSL)

`setup/start.sh` はリポジトリに含まれているため、生成作業は不要。実行ビットだけ確認する。

```bash
ls -l ~/newcleus/setup/start.sh    # -rwxr-xr-x になっていること
chmod +x ~/newcleus/setup/start.sh # 付いていなければ付与（通常は tar がモードを保持するので不要）
```

> **why:** 以前はこの手順でヒアドキュメントから `start.sh` を生成していたが、`/home/ubuntu/newcleus` 固定の内容になり、開発サンドボックスなど別の配置では動かなかった。スクリプトは `BASH_SOURCE` から自分の位置を解決する実装をリポジトリ側に置いたため、手順は「生成」ではなく「実行ビットの確認」だけにした。CRLF 化を防ぐため `.gitattributes` で `*.sh text eol=lf` を指定している。

WSL を抜ける:

```bash
exit
```

---

## 8. 起動テスト (Windows)

PowerShell から:

```powershell
wsl -d Ubuntu -u ubuntu -- bash -i /home/ubuntu/newcleus/setup/start.sh
```

ブラウザで `http://localhost:3001` を開き、setup0 画面が表示されることを確認したら `Ctrl+C` で停止。

---

## 9. WSL イメージのエクスポート (Windows)

```powershell
d:
cd d:\wsl_backup\
wsl --export Ubuntu newcleus-latest.tar
```

> **why:** `--export` は実行中のディストロを停止してから tar 化する。VHDX のスナップショットではないので、別マシンでも `wsl --import` で復元できる。

---

## 10. 圧縮 + ハッシュ算出 (WSL)

```bash
# why: pigz は gzip のマルチコア版。出力は gzip 完全互換で、
#      コア数に比例して圧縮時間が短縮される（8 コアなら理論上 ~8 倍高速）。
#      未インストールの場合のみ apt で導入する。
sudo apt-get install -y pigz

cd /mnt/d/wsl_backup
pigz -9 -k newcleus-latest.tar
sha256sum newcleus-latest.tar.gz > newcleus-latest.tar.gz.sha256
ls -l --si
```

> **why:** GitHub Release の単一アセットは 2 GB 上限。`pigz -9`（並列 gzip）で WSL イメージを圧縮し、ダウンロード後の改ざん検知のため sha256 を同梱する。`gzip -d` で展開できる完全互換形式のため受け取り側への影響はない。

---

## 11. GitHub Release 作成 (Windows)

初回のみ `gh` CLI 導入と認証:

```powershell
winget install --id GitHub.cli -e --accept-package-agreements --accept-source-agreements
gh auth login
```

リリース公開:

```powershell
cd d:\wsl_backup\
# newcleus-release-notes.md をテキストファイルとして保存してから
gh release create v1.0.6 `
   D:\wsl_backup\newcleus-latest.tar.gz `
   D:\wsl_backup\newcleus-latest.tar.gz.sha256 `
   --repo okamoto53515606/newcleus `
   --title "v1.0.6" `
   --notes-file D:\wsl_backup\newcleus-release-notes-v1.0.6.md
```

> **リリースノートの型:** [release-notes-template.md](./release-notes-template.md) を使う。**「アップデート手順（既存ユーザー）」を必ず含める**こと。配布済みイメージの利用者は CDK コマンドを叩かず、セットアップ画面の `setup1b` から反映する。

---

## 12. 配布後のアップデート（利用者向け）

> **why:** 配布済みイメージの利用者は、CDK コマンドではなくセットアップ画面のボタンで更新する。差し替え時に消してはいけないファイル（`.env` / `setup/setup-state.json`）と、コード変更には `setup1b` の再デプロイが必要であることを、利用者向けに明文化しておく必要がある。

手順は [update.md](./update.md) に集約している。リリースノートには同ドキュメント §6 の型で「押すボタン」だけを書く。

既存ユーザーは `fetch-app.sh --update --build` でファイルを差し替える（イメージの再取り込みは不要）。

```bash
(
  set -euo pipefail
  curl -fsSL --retry 3 -o /tmp/fetch-app.sh \
    https://raw.githubusercontent.com/okamoto53515606/newcleus/main/setup/scripts/fetch-app.sh
  bash -n /tmp/fetch-app.sh
  bash /tmp/fetch-app.sh --dir "$HOME/newcleus" --update --build
)
```

---

## チェックリスト

イメージ出荷前に最低限確認:

- [ ] `wsl -d Ubuntu -u ubuntu -- bash -i /home/ubuntu/newcleus/setup/start.sh` で `Ready in ...` が出る
- [ ] `http://localhost:3001/setup0` が表示される
- [ ] `docker info` が成功する（daemon 自動起動）
- [ ] `~/newcleus/setup/.next/BUILD_ID` が存在し、`~/newcleus/node_modules` も存在する
- [ ] `~/newcleus/package.json` の `version` がリリースタグと一致している（`setup` を再ビルドしてから export したか）
- [ ] `~/newcleus/.env` が `env_template.txt` のコピーである（AWS キー等が混入していない）
- [ ] `ls ~/newcleus/prompt_history` が失敗する（配布物から除かれている）
- [ ] `~/newcleus/setup/start.sh` に実行ビットが付いている（`-rwxr-xr-x`）

> 個人情報混入リスクは「`wsl --install` でクリーンな Ubuntu を作り、GitHub public リポジトリ以外からファイルを持ち込まない」運用で回避する。`.env` は `env_template.txt` のコピーで、AWS キー等は受け取り側が setup 画面から入力する設計。
