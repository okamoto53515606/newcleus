# newcleus のアップデート手順（既存ユーザー向け）

> **why:** 配布している WSL イメージは「ツール一式 + ビルド済みのセットアップ画面」を固めたもの。受け取り側は `http://localhost:3001` のセットアップ画面から操作する前提なので、アップデートも画面操作で完結させる必要がある。一方で「どの変更がどこまで反映されるか」を先に決めておかないと、「デプロイしたのに反映されない」「コード 1 行の修正のために 30〜60 分待たされる」という取り違えが起きる。

> このドキュメントは配布物内の `~/newcleus/docs/update.md` でも読める（`docs/` を含めて配布したイメージの場合）。開発者向けの詳細（CDK の構成、`.env` の各キーの意味）は `docs/blueprint.md` / `docs/setup1.md` を参照する。

---

## 1. 前提 — 配布物の中身と、更新時に壊してはいけないもの

| パス | 中身 | 更新時の扱い |
|---|---|---|
| `~/newcleus/` | アプリ本体ソース・`cdk/`・`Dockerfile` | 新しい版で**差し替える対象** |
| `~/newcleus/.env` | AWS キー / Cognito（`COGNITO_USER_POOL_ID`・`COGNITO_CLIENT_ID`・`COGNITO_DOMAIN`）/ `CLOUDFRONT_DOMAIN` / `TABLE_PREFIX` / `S3_BUCKET_NAME` | **必ず引き継ぐ**（消すと AWS 認証・ログイン・サイトの公開ドメインが失われる） |
| `~/newcleus/setup/setup-state.json` | セットアップの進捗（どの Step まで完了したか） | **必ず引き継ぐ**（消すと Step が未完了に巻き戻る） |
| `~/newcleus/node_modules` | `npx cdk` 実行用の依存 | 差し替え後に再インストール |
| `~/newcleus/setup/node_modules`・`setup/.next` | セットアップ画面本体（`next start` で配信） | 差し替え後に**再ビルド必須** |

理由: `setup` は `next start` で配信しているため、`.next` を作り直さないと**画面のコードが古いまま**になる。`.env` と `setup-state.json` はリポジトリに含まれない（`.env` は `env_template.txt` から作る）ため、ファイル差し替えの際に取り残すと復旧に手間がかかる。

---

## 2. 変更種別ごとの反映経路

| 変更内容 | 使う経路 | 所要時間 | 何が更新されるか |
|---|---|---|---|
| **ドキュメント・設定ファイルのみ**（`docs/`、`.gitattributes` 等） | ファイルの差し替えのみ | 数分 | 何も再デプロイされない |
| **アプリのコードのみ**（Next.js / Route Handler / 画面 / CSS） | `setup1b` →「CDK デプロイを実行（サイト公開）」 | 30〜60 分 | Lambda のコンテナイメージ（Docker ビルド込み） |
| **CDK の構造変更**（DynamoDB の GSI 追加・新規 Lambda・IAM・CloudFront 設定・環境変数） | 同上 | 30〜60 分 | `NewcleusInfraStack` 全体 |
| **Cognito の変更** | `setup1a`（必要な場合のみ） | 数分〜 | `NewcleusCognitoStack` |

> **アプリコードの高速更新は現状できない。** `setup/lib/cdk-ops.ts` には `buildAndPushAppImage()` / `updateLambdaImage()`（Docker build → ECR push → `UpdateFunctionCode` のみ）が用意されているが、それを呼ぶ画面（`/ops`）と API ルートがまだ無い。そのためコード変更も `setup1b` 経由で反映する。
> なお `cdk-ops.ts` は別プロジェクトから移植した状態で、`JWT_SECRET` / `StripeWebhookProxyUrl` / WAF といった newcleus に存在しない前提が残っている。`/ops` を実装する際は先にこのファイルの整理が必要。

### コマンドラインで CDK を実行する場合

`cdk/bin/newcleus.ts` は `.env` を読み込み、`--context` 未指定なら Cognito 3 値と `CLOUDFRONT_DOMAIN` を補完する（明示指定が優先）。そのため素の `npx cdk deploy NewcleusInfraStack` でも設定が空で上書きされることはない。

ただし、**利用者への案内は必ずセットアップ画面（`setup1b`）にする**。理由は次の 2 点。

- `setup1b` はデプロイ後に `.env` の更新（`S3_BUCKET_NAME` / `CLOUDFRONT_DOMAIN`）と Cognito コールバック URL の追加まで行う
- Docker ビルドを含むため、CLI から叩くと `Docker` / `npx cdk` のバージョン差異がそのまま失敗要因になる

---

## 3. ファイルを新しくする手順

### 3-1. WSL 内で差し替える（推奨）

配布イメージには `docs/` が入っているため、この手順書は `~/newcleus/docs/update.md` でも読める。

手元のスクリプトが古いと、修正済みの挙動（旧ツリーの退避・`.env` の引き継ぎ・ビルド検証）が効かない。そのため**毎回 GitHub から最新を取得してから実行する**。取得に失敗した場合はそこで停止し、古いスクリプトでは続行しない。

```bash
(
  set -euo pipefail
  curl -fsSL --retry 3 -o /tmp/fetch-app.sh \
    https://raw.githubusercontent.com/okamoto53515606/newcleus/main/setup/scripts/fetch-app.sh
  bash -n /tmp/fetch-app.sh   # 壊れたファイル/別物を掴んでいないか構文チェック
  bash /tmp/fetch-app.sh --dir "$HOME/newcleus" --update --build
)
```

- `( ... )` はサブシェルなので、途中で失敗しても WSL のシェル自体は閉じない（終了コードは `echo $?` で確認できる）
- `--dir` は必須。スクリプトが `/tmp` にあるため、対象を自分の位置から決められない
- 確認プロンプトを出さずに流す場合は `--yes`、タグを固定したい場合は `--ref v1.0.6`
- スクリプトの実体は `setup/scripts/fetch-app.sh`。処理は「ダウンロード → レイアウト検証 → `prompt_history`/`test` の除去 → 旧ツリー退避 → `.env` / `setup-state.json` の引き継ぎ → `npm install` → `setup` の `next build` → `setup/.next/BUILD_ID` の存在確認」
- `--build` を外すと `.next` が古いままになり、差し替えた画面が反映されない
- `npm install` が `Cannot read properties of null (reading 'edgesOut')` で落ちる場合は `npx -y npm@11 install` を使う
- **`rm -rf ~/newcleus` を先に実行しないこと。** `.env` と `setup/setup-state.json` が消え、AWS 認証・ログイン設定・セットアップ進捗を失う（スクリプトは旧ツリーを退避してから差し替える）

差し替えに成功すると、旧ツリーが `~/newcleus.old-YYYYMMDD-HHMMSS` として残る。動作確認後に削除する。

```bash
rm -rf ~/newcleus.old-*    # 動作確認後
```

### 3-2. 新しい WSL イメージを取り込み直す（非推奨）

インストーラで新イメージを入れ直す方法。VHDX ごと入れ替わるため、**`.env` と `setup-state.json` は自動では引き継がれない**。事前に Windows 側へコピーし、取り込み後に戻す必要がある。手間とリスクが大きいので、通常は 3-1 を使う。

---

## 4. 更新の反映と確認

1. **差し替え後のバージョンを確認**

   ```bash
   grep '"version"' ~/newcleus/package.json | head -1
   ```

2. **セットアップ画面を起動し直す**

   ```powershell
   wsl -d newcleus -u ubuntu -- bash -i /home/ubuntu/newcleus/setup/start.sh
   ```

   セットアップ画面自体にはバージョン表記が無い。`setup/.next` が再ビルドされたかは、次のコマンドでビルド日時を見る。

   ```bash
   stat -c '%y' ~/newcleus/setup/.next/BUILD_ID
   ```

3. **変更内容に応じてデプロイする**

   - アプリコード/CDK の変更あり → セットアップ画面 → `setup1b` →「CDK デプロイを実行（サイト公開）」
   - ドキュメントのみ → デプロイ不要

4. **管理画面のサイドバー下部でバージョンを確認する**

   管理画面（`https://<CloudFront ドメイン>/admin`）のサイドバー下部には `package.json` のバージョンが表示される。この値は **Lambda のコンテナイメージに焼き込まれた値**なので、「新しいソースに差し替えたがデプロイしていない」状態を検知できる。

5. **公開サイトを確認する**

   CloudFront の default behavior は `CACHING_DISABLED` のため、HTML（SSR）はエッジにキャッシュされず、デプロイ直後から新しい応答になる。キャッシュ削除の操作は不要。

   > 例外は画像。`/media/*` は `newcleus-media-cache` ポリシーでキャッシュされるため、**同じファイル名で画像を差し替えた場合は古い画像が残る**。管理画面から再アップロードすると新しいキーになるため、この問題は起きない。

6. **（任意）Lambda の更新状態を確認する**

   ```bash
   set -a; . ~/newcleus/.env; set +a
   aws lambda get-function-configuration \
     --function-name newcleus-app \
     --region "${AWS_REGION:-ap-northeast-1}" \
     --query '[LastUpdateStatus,LastModified,Code.ImageUri]' --output text
   ```

   `Successful` になっていれば反映済み。

---

## 5. 前提が崩れたときの症状と対処

| 前提 | 崩れたときの症状 | 対処 |
|---|---|---|
| `.env` を引き継いでいる | `setup0` に戻る / AWS API が `Unauthorized` / 管理画面ログインが 500 / サイトのドメインが変わる | 退避ファイル（`~/newcleus.old-*`）から `.env` を戻す。消えた場合は `setup0` から再入力し、`setup1b` を再実行 |
| `setup/setup-state.json` を引き継いでいる | 完了済みの Step が未完了扱いになり、サイドバーがロック | 退避ファイルを戻す。無い場合は該当 Step を再実行 |
| `setup` を再ビルドしている | 画面が旧版のまま・新しい画面が出ない | `cd ~/newcleus/setup && npm install && npm run build` → セットアップ画面を再起動 |
| 構造変更は `setup1b` で反映する | コードだけ差し替えても、新テーブルや新 Lambda が無く 500 になる | `setup1b` を実行する（差し替えだけでは AWS 側は変わらない） |
| 配布物は public リポジトリの tar から作る | `fetch-app.sh` の `curl` が 404/401 で止まる | リポジトリの公開設定と `--ref` を確認。private にする場合はトークン付き URL が必要 |

---

## 6. リリースノートに書く型

利用者に「何を押せばよいか」だけを伝える。CDK コマンドは書かない（利用者は WSL のセットアップ画面から操作する前提のため）。

```markdown
### アップデート手順（既存ユーザー）

1. WSL 内でファイルを差し替える（`docs/update.md` 3-1）

   ```bash
   (
     set -euo pipefail
     curl -fsSL --retry 3 -o /tmp/fetch-app.sh \
       https://raw.githubusercontent.com/okamoto53515606/newcleus/main/setup/scripts/fetch-app.sh
     bash -n /tmp/fetch-app.sh
     bash /tmp/fetch-app.sh --dir "$HOME/newcleus" --update --build
   )
   ```

2. セットアップ画面を起動し直す（`/home/ubuntu/newcleus/setup/start.sh`）
3. セットアップ画面 → `setup1b` →「CDK デプロイを実行（サイト公開）」
   （ドキュメントのみのリリースではこの行を削除）
4. 管理画面のサイドバー下部が vX.Y.Z になっていることを確認
5. 公開サイトを開き直す（HTML はキャッシュされないため、キャッシュ削除は不要）
```

> **配布側の確認:** リリース用イメージを作るときは `fetch-app.sh --fresh --dist` を実行し、`setup` を**再ビルドしてから**エクスポートする（`docs/wsl.md` §6 と §12 のチェックリスト）。

---

## 7. 前提が変わったときの要注意事項

| 前提 | その前提が崩れた場合に変わること |
|---|---|
| セットアップ画面は `next start` で配信する | `next dev` で配信する運用に変えるなら「`.next` 再ビルド必須」の記述（§1・§3-1・§4）が不要になる一方、起動が遅くなる |
| CloudFront の default behavior は `CACHING_DISABLED` | キャッシュポリシーを変更したら、§4 に「キャッシュ削除」の手順と invalidation 用 API（現状未実装）が必要になる |
| Node.js 24 系（`Dockerfile` も `node:24-alpine`） | 対応 Node を変更する場合は `fetch-app.sh` のバージョン警告、`docs/wsl.md` の nvm 手順、`Dockerfile` を同時に更新する |
| 高速更新（`/ops`）は未実装 | `/ops` を追加したら §2 の経路表を「コードのみ＝`/ops`」に書き換え、リリースノートの型（§6）も「押すボタン」を分けて書く |
| 配布物は public リポジトリの tar から作る | private 化する場合は `fetch-app.sh` の取得方法（トークン / Releases のアセット）を変更する |
| `.env` に `COGNITO_*` / `CLOUDFRONT_DOMAIN` が揃っている | 欠けていると `setup1b` のデプロイ後もログインできない。`setup1a` からやり直す |
