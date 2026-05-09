# Copilot Instructions

- 全体概要: docs/blueprint.md
- DB設計書: docs/database-schema.md
- AWS最新情報: MCP（aws-knowledge-mcp-server / brave-search）

## 進捗状況（2026-05-09 時点）

### 完了済み（blueprint.md § 7 フェーズ対応）

| フェーズ | 内容 | 状態 |
|---------|------|------|
| Phase 1 | プロジェクト雛形・不要物削除・DynamoDB設計 | ✅ 完了 |
| Phase 2 | setupアプリ + 管理画面: サイト管理CRUD + コンテンツタイプ管理CRUD | ✅ 完了 |
| Phase 3 | 記事CRUD + TinyMCE 7 エディタ + 画像アップロード(S3) + 汎用フィールド + テンプレート管理 | ✅ 実装済み |
| Phase 6 | テナント管理: siteadmin 管理（Cognito API） | ✅ 完了 |

#### setup 画面の完了状況
- `setup0`: AWS root キー検証 ✅
- `setup1a`: Cognito ユーザープール作成 + 管理者ユーザー作成（`custom:role=admin` 付与）✅
- `setup1b`: CDK InfraStack デプロイ（DynamoDB / S3 / Lambda / CloudFront）✅  
  → CloudFront: `d1sax4j5hw821p.cloudfront.net`
- `setup1c-iam`: IAM ユーザー発行 + root アクセスキー無効化 ✅

#### 実装済みの主要ファイル
- `cdk/` — CognitoStack + InfraStack（WafStack・独自ドメイン除去済み）
- `setup/` — セットアップ用 Next.js アプリ（ポート 3001）
- `src/app/admin/` — 管理画面（サイト管理・コンテンツタイプ管理・記事管理・テンプレート管理・テナント管理 CRUD）
- `src/app/api/admin/` — 管理 API Route Handler 群（sites / content-types / items / templates / tenants / preview）
- `src/lib/` — admin-auth / dynamodb / env 等ユーティリティ
- `src/components/admin/admin-sidebar.tsx` — サイドバー（ロール別メニュー・ユーザー情報・ログアウト・フッター）
- `Dockerfile` — Lambda Web Adapter + node:20-alpine 構成（ENTRYPOINTなし、/opt/extensions/ 配置方式）

### 未実装（次セッション以降の作業）

| フェーズ | 内容 |
|---------|------|
| Phase 4 | 公開API: `/api/v1/sites/{siteId}/items` JSON API + CORS |
| Phase 5 | 公開API: `embed.js` (Handlebars SSR) |
| Phase 7 | サイト追加時にいくつかのコンテンツタイプ＋テンプレート（お知らせとフォトギャラリー）を初期セットしたい。|

## 記述方針（必須）

- ソースコメントは「どう実装するか（How）」だけでなく「なぜそうするか（Why / 目的）」を先に明確に書く。
- CDKソースのコメントでは、構成理由・制約・運用上の意図（例: セキュリティ、循環依存回避、コスト）を明記する。
- gitコミットログは変更内容（How）だけでなく、背景と目的（Why）が第三者に伝わる件名/本文にする。

## AWS 情報の扱い

### 最新情報は aws-knowledge-mcp-server / brave-search で必ず検証する

**why:** AWS は CloudFront OAC・Lambda Function URL・Cognito 等、2023 年以降に仕様や推奨構成が頻繁に更新される領域が多い。LLM
単体の学習知識だけで断言すると、古い・誤った設定を生成して時間を浪費する（本プロジェクトでもOAC の DELETE body 等で実際に時間を失った）。

**ルール:**
- AWS サービスの仕様・制約・ベストプラクティス・API
引数を回答する前に、以下のいずれかで一次情報を確認する:
   - `aws-knowledge-mcp-server`（公式ドキュメント検索、優先）
   - `brave-search`（公式 docs にない実装 Tips、re:Post 等）
- 特に以下のトピックは必ず検証:
   - CloudFront OAC / Lambda Function URL / Lambda Web Adapter
   - Cognito（Hosted UI、MFA、OAuth2 PKCE）
   - VPC Endpoint / PrivateLink 関連

## コーディングルール（禁止事項）

### `"use server"` ディレクティブ禁止（Server Actions 禁止）

**why:** 本プロジェクトは CloudFront OAC + Lambda Function URL（AWS_IAM）構成。Server
Actions は Next.js が生成する内部 POST で動き、viewer が送る `x-amz-content-sha256`と実際の payload hash を一致させられないため、OAC の SigV4 署名検証で必ず 403になる。また攻撃面の最小化・レビュー容易性の観点でも Route Handlerに統一する。

**ルール:**
- `.ts/.tsx/.js/.jsx` のファイル先頭・関数先頭に `"use server"` / `'use server'`を書かない
- サーバー処理は `app/api/**/route.ts` に Route Handler として実装し、クライアントからは`fetchWithSigning()` 経由で呼び出す
- RSC（デフォルトの Server Component）や SSR は自由に使ってよい（GET なので OAC影響なし）

### DELETE リクエストに body を付けない

**why:** CloudFront は DELETE メソッドの body を origin に転送しない仕様。viewer が body 込みで SigV4 署名しても、Lambda 側に届く body は空になるため payloadhash が一致せず 403 になる。

**ルール:**
- DELETE はクエリ文字列（`URLSearchParams`）でパラメータを渡す

### DB 参照のあるページは `force-dynamic` を必ず付与

**why:** Next.js 16 は `cookies()`/`headers()` を使わない RSC をビルド時に SSG する。DynamoDB 参照ページを SSG させると「ビルド時の DB 状態（≒空）」の HTML が Lambda イメージに焼き付き、その後 DB を更新しても永久に古い HTML が返る（症状: `x-nextjs-prerender: 1` + 空コンテンツ。CDN invalidate しても解消しない）。

**ルール:**
- `getSiteSettings()` 等 DB を参照する Server Component には `export const dynamic = 'force-dynamic'` を入れる

### DB設計と UI の整合性

**why:** フォームの field type や項目名が `docs/database-schema.md` と乖離すると、登録データが DB に正しく格納されない。過去に `select`, `richtext` 等の存在しない型を UI に置いていた実例あり。

**ルール:**
- `FieldDefinition.type` は DB の列名プレフィックスに対応する `text | file | flag | date | num` の5種類のみ
- フォームに新しい型・フィールドを追加する前に `docs/database-schema.md` を確認する
- `fieldId` は DynamoDB のスロット識別子（`text0`〜`text9` 等）として使う

### 既知の注意点（再掲）
- DELETE に body を付けない（CloudFront が origin に転送しない → OAC 署名不一致）
- `"use server"` 禁止（Server Actions の内部 POST は OAC 署名不一致で 403）
