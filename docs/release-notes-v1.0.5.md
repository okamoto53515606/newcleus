# v1.0.5 リリースノート補足（アップデート手順）

> **why:** v1.0.5 のリリースノートは「変更内容・変動ファイル・検証結果」までで、**利用者が何を押せば反映されるか**が書かれていなかった。v1.0.5 は CDK テンプレート（`cdk/bin/newcleus.ts` / `cdk/lib/infra-stack.ts`）を変更しているため、ファイル差し替えだけでは修正が効かない。配布済みイメージの利用者向けに、この節をリリースノートへ追記する。

---

## 追記する本文

````markdown
---

## アップデート手順（既存ユーザー）

**v1.0.5 は CDK（インフラ）の変更を含みます。** ファイルを差し替えるだけでは修正が反映されないため、`setup1b` の再デプロイまで実行してください。

所要時間の目安: ファイル差し替え 3〜10 分 + デプロイ 30〜60 分

### 1. WSL 内でファイルを差し替える

```bash
(
  set -euo pipefail
  curl -fsSL --retry 3 -o /tmp/fetch-app.sh \
    https://raw.githubusercontent.com/okamoto53515606/newcleus/main/setup/scripts/fetch-app.sh
  bash -n /tmp/fetch-app.sh
  bash /tmp/fetch-app.sh --dir "$HOME/newcleus" --update --build
)
```

- `.env` と `setup/setup-state.json` は自動で引き継がれます
- 旧ツリーは `~/newcleus.old-YYYYMMDD-HHMMSS` に退避されます（動作確認後に削除してください）
- `--build` を外すとセットアップ画面が古いままになります

### 2. セットアップ画面を起動し直す

```powershell
wsl -d newcleus -u ubuntu -- bash -i /home/ubuntu/newcleus/setup/start.sh
```

### 3. `setup1b` で再デプロイする

セットアップ画面 → `setup1b` →「CDK デプロイを実行（サイト公開）」

**この操作が必要な理由:**

- v1.0.5 で `CLOUDFRONT_DOMAIN` を Lambda の環境変数テンプレートに含めた。CDK デプロイはテンプレートに無い環境変数を削除するため、**再デプロイしないと環境変数は復旧しない**
- 管理画面の記事一覧の修正（`queryAll()`）は Lambda のコンテナイメージに入る。イメージは CDK デプロイ時に Docker ビルドされる

### 4. 反映を確認する

1. 管理画面（`https://<CloudFront ドメイン>/admin`）にログインできる
2. サイドバー下部のバージョンが **v1.0.5** になっている
3. 記事一覧の 1 ページ目に新しい記事が表示される（2,500 件規模のサイトで確認済み）
4. 公開サイトのトップページが表示される

補足: HTML は CloudFront の default behavior が `CACHING_DISABLED` のため、キャッシュ削除は不要です。

### 5. うまくいかないとき

| 症状 | 確認すること |
|---|---|
| サイドバーのバージョンが 1.0.4 のまま | 手順 3 のデプロイが完了しているか（Lambda の `LastUpdateStatus`） |
| 管理画面のログインが 500 になる | `.env` に `COGNITO_USER_POOL_ID` / `COGNITO_CLIENT_ID` / `COGNITO_DOMAIN` が残っているか。無ければ `setup1a` から再実行 |
| セットアップ画面が旧版のまま | `--build` を付けて再実行し、`setup/.next/BUILD_ID` の日時を確認 |
| デプロイが失敗した | 旧ツリー（`~/newcleus.old-*`）を戻せば元の状態に切り戻せる |
````

---

## 配布側のメモ

- この追記は `gh release edit v1.0.5 --notes-file <file>` で反映できる（既存の本文に追記する形にする）
- 次回以降のリリースは `docs/release-notes-template.md` の型で最初から「アップデート手順」を含めて書く
- v1.0.5 の配布イメージを作り直す場合は `fetch-app.sh --fresh --dist` を使い、`setup` を再ビルドしてからエクスポートする
