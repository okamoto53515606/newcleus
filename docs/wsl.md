# 配布用 WSL イメージの作成メモ

> **why:** 一般ユーザーが `newcleus` をローカルでセットアップできるよう、必要なツール（Node.js / Docker / AWS CLI / プロジェクトコード）を全部入りで構成済みの WSL イメージを GitHub Releases で配布する。受け取り側は `wsl --import` するだけで、`http://localhost:3001` のセットアップ画面に進める状態を作る。

## 前提

- **Windows 11**（`wsl --install` がワンコマンドで Ubuntu 導入できるバージョン）。Windows 10 はサポート対象外。
- インストール後の Ubuntu はクリーンな状態から構築し、`git clone`（`tar -xz`）以外のソースを混入させない。これにより配布物に個人情報が混入しない（リポジトリは public で個人情報なし、`.env` は `env_template.txt` のコピーのみ）。

## 全体フロー

1. **Windows**: クリーンな Ubuntu WSL を作成
2. **WSL (Ubuntu)**: 必要ツール導入 → リポジトリ取得 → ビルド → 起動スクリプト配置
3. **Windows**: `wsl --export` で tar 化
4. **WSL**: tar を gzip 圧縮 + sha256 算出
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

### Node.js (nvm 経由で Node 22)

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash
source ~/.bashrc
nvm --version
nvm install 22
nvm use 22
```

> **why:** Next.js 16 / aws-cdk-lib の最新が要求する Node 20+ を満たすため、長期サポートの 22 を採用。

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

エクスポート前に行う「配布イメージを軽くする & ネットワークを安定化させる」掃除工程。`wsl --import` 後に手元で動かすだけなら省略可だが、**Release に上げる前の最終工程としては必須**。

### 4-1. DNS の固定化

WSL 既定の `resolv.conf` 自動生成は Windows 側のホスト DNS を引き継ぐ。配布先の環境に依存して `npm install` / `apt-get update` が DNS 失敗で詰まる事故を避けるため、Google Public DNS (`8.8.8.8`) を固定値で焼き込む。

```bash
sudo su -
echo "" >> /etc/wsl.conf
echo "[network]" >> /etc/wsl.conf
echo "generateResolvConf = false" >> /etc/wsl.conf
echo "nameserver 8.8.8.8" | sudo tee /etc/resolv.conf
exit
```

> **why:** `[network] generateResolvConf = false` を設定しないと WSL 起動毎に `/etc/resolv.conf` が自動上書きされて `8.8.8.8` の固定が消える。

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

# テンポラリファイルとログのクリア
sudo rm -rf /tmp/*
sudo rm -rf /var/tmp/*
sudo find /var/log -type f -exec cp /dev/null {} \;
```

> **why:** `/var/lib/apt/lists` と `/usr/share/doc` `/usr/share/man` は合計で数百 MB〜1GB 規模を占める。配布物では再度 `apt-get update` を走らせれば apt インデックスは復旧するため安全に消せる。`copyright` ファイルだけは GPL 等のライセンス義務で残す。ログは `cp /dev/null` で **inode を保持したまま中身だけ空に** することで、journald 等の書き込み先 fd を壊さない。

---

## 5. リポジトリ取得 (WSL)

```bash
mkdir -p ~/newcleus
cd ~/newcleus
curl -L https://github.com/okamoto53515606/newcleus/archive/refs/heads/main.tar.gz \
  | tar -xz --strip-components=1

# why: 配布イメージサイズ削減 & ユーザーが触る必要のないファイルを除く
rm -rf docs prompt_history

cp env_template.txt .env
```

---

## 6. 環境チェック (WSL)

すべてバージョンが出ること、Docker daemon が OK であることを確認。

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

## 7. 依存インストール & ビルド (WSL)

> **why:** 配布後の初回起動を高速化するため、`npm install` と setup の `next build` を配布側で済ませて `node_modules` / `.next` ごとイメージに固める。  
> ルート (`~/newcleus`) は CDK 用依存だけが必要 (`aws-cdk-lib`, `@types/node` 等)。Next.js 本体の build はランタイムでは Lambda コンテナビルド経由で行うため不要。

```bash
# ルート: CDK 用依存のみ
cd ~/newcleus
rm -rf node_modules .next
npm install

# setup: 依存 + Next.js プロダクションビルド
cd ~/newcleus/setup
rm -rf node_modules .next
npm install
npm run build
```

---

## 8. 起動スクリプト配置 (WSL)

```bash
cat > ~/newcleus/setup/start.sh <<'EOF'
#!/usr/bin/env bash
# why: dev (Turbopack) は初回コンパイルが重く、低スペック環境で固まりやすい。
#      build 済み成果物を next start で配信することで起動を一瞬にする。
source ~/.bashrc
cd ~/newcleus/setup
npm run start
EOF
chmod +x ~/newcleus/setup/start.sh
```

WSL を抜ける:

```bash
exit
```

---

## 9. 起動テスト (Windows)

PowerShell から:

```powershell
wsl -d Ubuntu -u ubuntu -- bash -i /home/ubuntu/newcleus/setup/start.sh
```

ブラウザで `http://localhost:3001` を開き、setup0 画面が表示されることを確認したら `Ctrl+C` で停止。

---

## 10. WSL イメージのエクスポート (Windows)

```powershell
d:
cd d:\wsl_backup\
wsl --export Ubuntu newcleus-latest.tar
```

> **why:** `--export` は実行中のディストロを停止してから tar 化する。VHDX のスナップショットではないので、別マシンでも `wsl --import` で復元できる。

---

## 11. 圧縮 + ハッシュ算出 (WSL)

```bash
cd /mnt/d/wsl_backup
gzip -9 -k newcleus-latest.tar
sha256sum newcleus-latest.tar.gz > newcleus-latest.tar.gz.sha256
ls -l --si
```

> **why:** GitHub Release の単一アセットは 2 GB 上限。`gzip -9` で WSL イメージを圧縮し、ダウンロード後の改ざん検知のため sha256 を同梱する。

---

## 12. GitHub Release 作成 (Windows)

初回のみ `gh` CLI 導入と認証:

```powershell
winget install --id GitHub.cli -e --accept-package-agreements --accept-source-agreements
gh auth login
```

リリース公開:

```powershell
cd d:\wsl_backup\
gh release create v1.0.0 `
   D:\wsl_backup\newcleus-latest.tar.gz `
   D:\wsl_backup\newcleus-latest.tar.gz.sha256 `
   --repo okamoto53515606/newcleus `
   --title "v1.0.0" `
   --notes "newcleus をリリースしました！"
```
