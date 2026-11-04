# DAST（OWASP ZAP + 認可プローブ）

`why:`
テスト用の代替環境を持たないため、**本番に対して** 実行時の脆弱性検査を行う。
PR レビューや `npm audit` では見つからない「実際に動いている状態の穴」
（認可漏れ / ヘッダ欠落 / 情報漏洩 / 入力検証の綻び）を検出することが目的。

`how:`
ZAP の能動スキャンと、ZAP では検出力が出ない領域（未認証での管理 API アクセス）を
自作のアサーションスクリプトで補う二段構成にしている。

## 実行順と頻度

| 順 | スクリプト | 対象 | 頻度 | 所要 | 本番への影響 |
|---|---|---|---|---|---|
| 1 | `admin-probe.sh` | 管理画面 / 管理 API（未認証） | 月次 | 1分 | 接続試行のみ |
| 2 | `zap-baseline.sh` | サイト全体（受動のみ） | 週次 | 3〜5分 | ほぼゼロ |
| 3 | `zap-api-scan.sh` | `/api/v1/**`（GET のみ） | 月次 | 10〜30分 | 読み取りのみ |
| 4 | `zap-full-scan.sh` | 全体（spider + active） | 四半期 | 30〜120分 | 負荷・キャッシュ汚染 |

`admin-probe.sh` を最初に回す理由: 認可漏れは影響が最も大きく、かつ 1 分で判定できる。
ここが FAIL のまま能動スキャンを回しても意味が薄い。

## 前提

- Docker が起動していること（`zaproxy/zap-stable` を pull する）
- `.env` に `CLOUDFRONT_DOMAIN` があること（対象 URL の既定値として使う）
- **認証情報は不要**。全スクリプトは未認証で動く。`.env` は値を読むだけで `source` しない
  （AWS の長期クレデンシャルをコンテナへ渡さないため）

## 使い方

```bash
./scripts/dast/admin-probe.sh
./scripts/dast/zap-baseline.sh
SITE_ID=<siteId> CONTENT_TYPE=<ctId> ./scripts/dast/zap-api-scan.sh
./scripts/dast/zap-full-scan.sh
```

`zap-api-scan.sh` だけは `SITE_ID` / `CONTENT_TYPE` が必須。
`why: テナント固有の ID は環境ごとに異なり、newcleus は配布物でもあるため、
公開リポジトリに値を固定しない。`
`admin-probe.sh` は「未認証で弾かれるか」しか見ないため、未指定ならダミー ID を使う。

別環境を叩く場合:

```bash
TARGET_BASE=https://staging.example.com ./scripts/dast/zap-baseline.sh
```

## 出力

`zap-reports/`（リポジトリルート、**`.gitignore` 済み**）

- `baseline-report.html` / `.json`
- `api-scan-report.html` / `.json`
- `full-scan-report.html` / `.json`
- `openapi.generated.yaml`（実行時に実 ID を埋め込んだ定義）

公開用のサマリは `node scripts/dast/summarize.mjs <json>` で生成する。
`summarize.mjs` は URL / パラメータ / 証跡を落とし、**ルール名と件数だけ**を出力する。

## 本番実行時のガードレール

| リスク | 対策 |
|---|---|
| DB へのゴミデータ混入 | `openapi.public.yaml` は **GET のみ**記載。管理 API は叩かない |
| 認可が破れていた場合の書き込み | プローブの書き込み系は不正ボディ（`{}` / 空）で叩く。通っても 400 で止まる |
| CloudFront キャッシュ汚染 | Full Scan 後に invalidation を実行する（手順は `docs/security/dast.md`） |
| Lambda 同時実行の圧迫 | 各スクリプトに `-m` / `-T` の時間上限を設定。四半期の Full Scan はアクセスが少ない時間帯に実行 |

### 書き込み系を検査するときの注意（OAC の payload ハッシュ）

CloudFront OAC は、リクエストボディの SHA256 と `x-amz-content-sha256` ヘッダが
一致しないリクエストを **エッジで 403** にする。つまりヘッダを付けずに POST/PUT を
投げると「アプリが認可で弾いた」のか「エッジが署名で弾いた」のか区別できない。

`admin-probe.sh` は実クライアント（`fetchWithSigning()`）と同じヘッダを付けて
アプリ層まで到達させている。この挙動を忘れて素の curl で検査すると、
**認可漏れがあっても 403 が返って PASS に見える**ため注意。


## 誤検知（False Positive）の triage

`zap.conf` に `IGNORE` を追記する。**根拠をコメントで書けないものは IGNORE しない**
（IGNORE は警告を消すだけで、本物の脆弱性も見えなくなる）。

現在の IGNORE:

- `40018` SQL Injection — DynamoDB のみで SQL を組み立てない
- `40025` Proxy Disclosure — CloudFront 配信であることは公開情報
- `100001` Unexpected Content-Type — 大半が外部ドメイン、信号が弱い
- `10098` Cross-Domain Misconfiguration — 公開 API の CORS ワイルドカードは埋め込み仕様

## 対象のメンテナンス

- `src/app/api/v1/**/route.ts` を追加・変更したら `openapi.public.yaml` も更新する
  （未記載のエンドポイントは Active Scan の対象外になる）
- 管理 API を追加したら `admin-probe.sh` の一覧に追加する

## ローカルでの確認

```bash
npm run dev
TARGET_BASE=http://localhost:9002 ./scripts/dast/admin-probe.sh
```

ローカルでは CloudFront が付与するセキュリティヘッダ検査を自動でスキップする
（アプリ側の問題ではないヘッダ欠落を誤検知しないため）。

## CI 化（将来）

対象が本番のため毎 push 実行はしない。導入する場合は
`.github/workflows/dast.yml` で `workflow_dispatch` + `schedule`（週次の baseline のみ）とする。
