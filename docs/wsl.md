# 配布用 WSL イメージの作成・リリース

> **why:** 一般ユーザーが `newcleus` をローカルでセットアップできるよう、必要ツール（Node.js / Docker / AWS CLI / プロジェクトコード）を全部入りで構成済みの WSL イメージを GitHub Releases で配布する。受け取り側は `wsl --import` するだけで `http://localhost:3001` のセットアップ画面に進める。
>
> **作成・検証・公開は別プロジェクトのインストーラで自動化済み。** 手順の詳細はここには書かず、リンク先を正とする（二重管理で手順がずれるのを避けるため）。このドキュメントは「どこを見るか」と「newcleus 側で必要な準備」だけを示す。

## 手順の在処

| 知りたいこと | 場所 |
| --- | --- |
| 手順全体・パラメータ・失敗時の対処 | [homepage-v2-installer / newcleus / README.md](https://github.com/okamoto53515606/homepage-v2-installer/blob/main/newcleus/README.md) |
| 実行スクリプト本体 | [newcleus/build-wsl-image.ps1](https://github.com/okamoto53515606/homepage-v2-installer/blob/main/newcleus/build-wsl-image.ps1) |
| ツール導入（AWS CLI / Node 24 / Docker） | [wsl-image/provision.sh](https://github.com/okamoto53515606/homepage-v2-installer/blob/main/newcleus/wsl-image/provision.sh) |
| 軽量化・秘匿情報の除去 | [wsl-image/cleanup.sh](https://github.com/okamoto53515606/homepage-v2-installer/blob/main/newcleus/wsl-image/cleanup.sh) |
| リリース前検証ゲート | [wsl-image/verify.sh](https://github.com/okamoto53515606/homepage-v2-installer/blob/main/newcleus/wsl-image/verify.sh) |
| リポジトリ取得＋ビルド（newcleus 側） | [setup/scripts/fetch-app.sh](../setup/scripts/fetch-app.sh) |

> **why 別リポジトリか:** クリーンな Ubuntu の用意 → ツール導入 → ビルド → 軽量化 → export → 圧縮 → リリースという工程は newcleus のランタイムに依存しない。`homepage` 版と同じ仕組みを共有できるため、配布物を作る側の手順はインストーラ側に集約している。

## 実行

Windows（PowerShell）で、インストーラのリポジトリに移動して実行する。引数なしで「生成 → 検証 → 公開」まで進む。

```powershell
cd D:\work\homepage-v2-installer

# 1) 生成 + 検証だけ（GitHub には何も作られない）
.\newcleus\build-wsl-image.ps1 -SkipRelease

# 2) 成果物を確認してから公開（再検証 + gh release create --latest）
.\newcleus\build-wsl-image.ps1 -SkipBuild
```

成果物は `D:\wsl_backup\newcleus-latest.tar.gz` と `.sha256`。`--latest` 付きで公開されるため、利用者には固定 URL `https://github.com/okamoto53515606/newcleus/releases/latest/download/newcleus-latest.tar.gz` を案内できる。

## newcleus 側でやること（このリポジトリの作業）

1. **`package.json` の `version` を上げて push する**
   - ビルドスクリプトは GitHub 上の `package.json` の `version` とリリースノートのファイル名を突き合わせ、**一致しなければ失敗する**。raw は CDN キャッシュされるため、push 直後の実行は 1〜2 分待たされることがある。
2. **リリースノートを `D:\wsl_backup\newcleus-release-notes-v<version>.md` に置く**
   - ファイル名の `<version>` がそのままタグ `v<version>` になる（`v` は付けない）。
   - 本文の型は [release-notes-template.md](./release-notes-template.md)。「アップデート手順（既存ユーザー）」を必ず含める。
3. **（必要な場合のみ）`setup/scripts/fetch-app.sh` を push する**
   - ビルド時に newcleus の `main` から最新を取得して `--fresh --dist --yes` で実行する。手元のコピーは使われない。

## 焼き込まれる内容（変えると配布物が壊れる前提）

- **配置:** `~/newcleus` に `main` のツリー。`node_modules` と `setup/.next` は**ビルド済み**（初回起動を速くするため）。
- **`.env`:** `env_template.txt` のコピーのみ。AWS キー等は受け取り側が setup 画面から入力する（秘匿情報が混入していないことを `cleanup.sh` が検査し、ヒットしたらビルド失敗）。
- **起動:** `wsl -d newcleus -u ubuntu -- bash -i /home/ubuntu/newcleus/setup/start.sh`。`start.sh` は `BASH_SOURCE` から自分の位置を解決する。
- **ユーザー:** `ubuntu`（NOPASSWD sudo）。`/etc/wsl.conf` に `systemd=true` / `default=ubuntu`。
- **バージョン確認:** `package.json` の `version` と `setup/.next/BUILD_ID`（版を焼き込む仕組みは無い）。

| newcleus 側の変更 | 一緒に直すもの |
| --- | --- |
| `setup/start.sh` のパス・起動方法 | `wsl-image/verify.sh`（起動確認）、[setup1.md](./setup1.md) の起動コマンド、[update.md](./update.md) |
| `.env` の作り方（`env_template.txt` 以外にする） | `fetch-app.sh --fresh`、`wsl-image/verify.sh` の検査項目 |
| Node.js のメジャーバージョン | `wsl-image/provision.sh`（nvm）、`wsl-image/verify.sh`（v24 系チェック） |
| 成果物名・distro 名 | `build-wsl-image.ps1` の定数、[setup1.md](./setup1.md) |
| `package.json` の `version` | リリースノートのファイル名（一致必須） |

## 利用者向けドキュメント

- 新規インストール: [setup1.md](./setup1.md)
- 既存環境の更新: [update.md](./update.md)（`fetch-app.sh --update --build` で差し替え。イメージの再取り込みは不要）
- リリースノートの型: [release-notes-template.md](./release-notes-template.md)

## 注意

- WSL のカーネル自体はイメージに含まれない。ホスト側は `wsl --update` で最新化する。
- GitHub ホストの Windows ランナーは WSL2 が動かないため、CI 化する場合はセルフホスト Windows ランナーが必要。
