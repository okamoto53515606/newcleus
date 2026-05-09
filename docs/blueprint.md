# newcleus — Blueprint v0.0.4

> 名前の由来: "new" + "Nucleus CMS"。 20年前のNucleus CMSの設計思想をリスペクトしつつ、モダン技術で再実装するプロジェクト。

## 1. プロダクト概要

小規模サイト向けの **マルチテナントCMS SaaS**。
複数の利用者（クリニック、事務所、アーティスト等）がそれぞれ自分専用の管理画面にログインし、自分の記事だけを追加・編集できる。公開側は利用者の自サイトにscriptタグで記事を埋め込む形。

### コアコンセプト（Nucleusから引き継ぐ最重要設計）

```
┌─ SaaS全体 ──────────────────────────────────────────┐
│                                                       │
│  サイトA (= 利用者A)         サイトB (= 利用者B)       │
│  ├── CT: お知らせ            ├── CT: ニュース          │
│  ├── CT: 求人情報            └── CT: ブログ            │
│  ├── 記事1, 記事2, ...       ├── 記事1, 記事2, ...    │
│  └── siteadmin: userA@gmail  └── siteadmin: userB@gmail │
│                                                       │
│  ※ 利用者Aは自分のサイトAの記事のみ見える・操作できる  │
│  ※ 利用者Bは自分のサイトBの記事のみ見える・操作できる  │
│  ※ admin（運営者）は全サイトを管理できる               │
└───────────────────────────────────────────────────────┘
```

- Nucleusでは `blog` テーブルがこのテナント単位だった（1 blog = 1利用者の記事リスト）
- 新CMSでは DynamoDB の `sites/{siteId}` コレクションがこれに相当する
- 利用者追加 = サイト作成 + Cognitoアカウント紐づけ で完了

### 基本情報

- **想定規模:** 年間20サイト未満
- **旧資産:** 20年前のNucleus CMS（PHP）の設計思想・DB設計 + AWSベースの個人メディア「homepage-v2」のコード資産
- **新技術スタック:** Next.js (TypeScript) + AWS（ .sample-files/homepage/docs/blueprint_v2.md を参照）

---

## 2. アーキテクチャ

```
┌──────────────────────────────────────────────────────────┐
│  管理画面 (Next.js App Router)          │
│  - setup画面からCDK でデプロイ        │
│  - Cognito提供ログイン画面を利用(homepage資産から流用)      │
│  - TinyMCE 7 Core エディタ (HTML出力)    │
│  - 画像: browser-image-compression → Cognito認証で保護されたサーバサイドAPI（/api/admin/xxx） → S3     │
│  - サーバーサイド:  DynamoDB読み書き      │
│  - Cognito認証で保護されたサーバAPI（/api/admin/xxx）をfetchで呼び出し  │
└──────────────┬───────────────────────────────────────────┘
               │
┌──────────────▼───────────────────────────────────────────┐
│  AWS                             │
│  DynamoDB: サイト・記事・コンテンツタイプ・ユーザー   │
│  S3:   画像ファイル (Cloudfront配信)     │
│  Auth:     Cognito + custom:xxx属性(admin/siteadmin) │
└──────────────┬───────────────────────────────────────────┘
               │
┌──────────────▼───────────────────────────────────────────┐
│  公開API (Next.js API Routes)                              │
│  GET /api/v1/sites/{siteId}/items  → JSON                  │
│  GET /api/v1/sites/{siteId}/items/{itemId}  → JSON         │
│  GET /api/v1/sites/{siteId}/render → テンプレート適用済HTML  │
│  GET /api/v1/sites/{siteId}/embed.js → scriptタグ埋め込みJS│
│  - CORSは全て許可               │
│  - GET only / パラメータは英数字ハイフンアンダーバーのみ    │
│  - POST受付なし / 全て公開情報                             │
└─────────────────────────────────────────────────────────┘

利用者サイト (任意のHTML):
  <div id="cms-news"></div>
  <script src="https://xxx.cloudfront.net/api/v1/sites/{siteId}/embed.js?contentType=news&limit=5"></script>
```

---

## 3. homepage-v2との違い

newcleus は MVP として決済・AI生成・外部認証などを省き、できる限りシンプルにしています。
homepage-v2 のベースがあるため開発コストを抑え、使用 AI モデルも低コストなものを選択しています。

| 項目 | homepage-v2 | newcleus |
|------|-------------|----------|
| インストーラー | あり | なし（PowerShell から `wsl --import` → `setup/start.sh` で手動起動） |
| CORS | サイトごとに制御 | 全て許可 |
| CSP | あり | なし |
| テスト・DAST | GitHub Actions + 定期 ZAP | なし |
| 独自ドメイン | あり | なし（`xxx.cloudfront.net` を使用） |
| WAF | あり | なし |
| Cognito 2FA | あり | なし |
| CDN キャッシュ | あり | `/media/` 配下のみ 1 時間、それ以外なし |
| 決済 | Stripe 連携あり | なし |
| Google ログイン | あり | なし |
| AI 記事生成 | Genkit 連携あり | なし |
| Markdown | `react-markdown` / `remark-gfm` あり | なし |
| セットアップメニュー | setup1c・setup2系・setup3系・ops あり | なし |
| 開発 AI モデル | Claude Opus 4.7 | Claude Sonnet 4.6 |

### 参考資料

- homepage-v2 の GitHub: https://github.com/okamoto53515606/homepage
- v1→v2 切替の経緯と方針: https://github.com/okamoto53515606/homepage/blob/main/docs/blueprint_v2.md

---

## 4. Nucleusから引き継ぐ設計思想

| Nucleus の概念 | 新CMS での対応 |
|----------------|----------------|
| blog (テナント単位) | `sites/{siteId}` コレクション |
| item (記事) | `sites/{siteId}/items/{itemId}` サブコレクション |
| category | `sites/{siteId}/contentTypes/{contentTypeId}` サブコレクション |
| member + team (ユーザーとブログの紐づけ) | Cognito `custom:siteIds`（JSON文字列配列）で管理 |
| MyShowBlogsの汎用フィールド (text0-9, file0-9, flag0-9, date0-9, num0-9) | `items/{itemId}.fields` マップ |
| MyShowBlogsのフィールド定義 (plugin_option_desc) | `contentTypes/{contentTypeId}.fieldLabels` マップ |
| MyShowBlogsのフィルタ (flag0=1等) | 公開APIのクエリパラメータ |
| iframe埋め込み | scriptタグ埋め込み (embed.js) に進化 |
| テンプレート (skin/template) | `contentTypes/{ctId}/templates` サブコレクション + Handlebarsテンプレートエンジン |

---

## 5. 管理画面の機能一覧

### 5.1 認証・権限管理

- Cogniteログインのみ
- ロール: `admin`（スーパー管理者）/ `siteadmin`（サイト管理者）の **2種のみ**
- **権限は Cognitoのcustom:属性 のみで管理（DBに権限情報を持たない）**
- `admin` はsetup画面で付与
- `siteadmin` は管理画面にadminでログインして付与
- custom:属性の構造: `{ role: "admin" | "siteadmin", siteIds: ["siteId1", ...] }`
  - `admin` の場合 `siteIds` は不要（全サイトアクセス可）
  - `siteadmin` は `siteIds` に紐づくサイトのみ操作可能（複数サイト紐づけ可）

### 5.2 サイト管理 (admin)

- サイト作成: name, shortname, allowedOrigins
- サイト作成時にDynamoDBに初期コンテンツタイプ自動生成
- サイト一覧・編集・削除
- siteadmin登録、削除（Cognito API）
- siteadmin一覧表示（Cognito ListUsers から取得し、`custom:role=siteadmin` でフィルタ）

### 5.3 コンテンツタイプ管理 (admin / siteadmin)

- コンテンツタイプCRUD (name, shortname, sortOrder, fieldLabels)
- コンテンツタイプ別の汎用フィールドラベル定義 (fieldLabelsマップ)
  - 例: text0 = "概要", file0 = "メイン画像", flag0 = "公開フラグ"
  - ラベル未定義のフィールドは管理画面に表示しない

### 5.4 テンプレート管理 (admin / siteadmin)

- コンテンツタイプに紐づくテンプレートのCRUD
- テンプレートエンジン: **Handlebars** — Mustache互換 + `{{#if}}`, `{{#each}}`, `{{#unless}}`, カスタムヘルパー等、表現力が高くテンプレート構文を覚えれば柔軟に対応可能
- 管理画面でテンプレートHTMLをコードエディタで編集
- プレビュー機能: ダミーデータでテンプレート適用結果を確認
- 1コンテンツタイプに複数テンプレート可（例: 一覧用、ティッカー用、カード用）
- テンプレート保存時に `<script>` タグ / `on*` イベント属性をサニタイズ除去

#### テンプレートで利用可能な変数

| 変数 | 型 | 説明 |
|------|------|------|
| `items` | 配列 | 条件にマッチした記事リスト。各要素は `title`, `body`, `fields.*`, `createdAt` 等全項目利用可 |
| `item` | オブジェクト | 先頭1件の記事。単一記事表示用のショートカット |

※ 条件にマッチする記事が0件の場合、embed.jsは何も出力しない

#### テンプレート例（お知らせ一覧）

```handlebars
{{#each items}}
<div class="news-item">
  <time datetime="{{createdAt}}">{{formatDate createdAt}}</time>
  <h3>{{title}}</h3>
  <p>{{fields.text0}}</p>
  {{#if fields.flag0}}<span class="badge-urgent">緊急</span>{{/if}}
</div>
{{/each}}
```

#### テンプレート例（単一ページ表示）

```handlebars
{{#with item}}
<article>
  <h2>{{title}}</h2>
  <div>{{{body}}}</div>
</article>
{{/with}}
```

### 5.5 記事管理 (admin / siteadmin)

- 記事一覧（自サイトの記事のみ表示）
- 記事作成・編集
  - タイトル入力
  - TinyMCE 7 Core でHTML本文編集（画像埋め込み対応）
  - コンテンツタイプ選択
  - 汎用フィールド入力（コンテンツタイプのfieldLabels定義に基づき動的フォーム生成）
    - text: テキストエリア
    - file: 画像アップロード（S3）
    - flag: チェックボックス
    - date: 日付ピッカー
    - num: 数値入力
  - 公開/下書き切り替え
- 記事削除

### 5.6 WYSIWYGエディタ

- TinyMCE 7 Core（MIT License）
- 最低限の装飾: 太字、イタリック、リンク、箇条書き、見出し(h2-h4)
- 画像挿入: アップロードボタン → browser-image-compression (1MB/1024px上限) → S3 → URL挿入（例: https://xxx.cloudfront.net/media/siteId/yyyymmddhhmmss-xxx.jpg）
- HTML出力をそのままDynamoDBに保存
- カスタムプラグイン不要、標準機能のみ

---

## 6. 公開API仕様

### エンドポイント

```
GET /api/v1/sites/{siteId}/items
  ?contentType={contentTypeId}  コンテンツタイプフィルタ (必須)
  &limit={number}           取得件数 (デフォルト10, 最大100)
  &page={number}            ページ番号 (デフォルト1)
  &sort={order}             日付ソート (desc または asc, デフォルトdesc)
  &flag0=1                  汎用フラグフィルタ (任意, flag0-flag9)

GET /api/v1/sites/{siteId}/items/{itemId}
  単一記事取得

GET /api/v1/sites/{siteId}/embed.js
  ?target={elementId}       描画先DOM要素ID (デフォルト "cms-content")
  &contentType={contentTypeId}  コンテンツタイプフィルタ (必須)
  &template={templateShortname}  テンプレート shortname (必須。例: list-modal, list-simple)
  &limit={number}           表示件数 (デフォルト5)
  &flag0=1                  汎用フラグフィルタ (任意)

GET /api/v1/sites/{siteId}/render
  ?contentType={contentTypeId}  コンテンツタイプフィルタ (必須)
  &template={templateShortname}  テンプレート shortname (必須。例: list-modal, detail)
  &limit={number}           取得件数 (デフォルト10)
  &flag0=1                  汎用フラグフィルタ (任意)
  → template 未指定時は 400 エラー（利用可能な shortname 一覧を案内）
  → Content-Type: text/html でテンプレート適用済HTMLを返却
  → マッチする記事が0件の場合、空のHTMLを返却
```

### レスポンス (JSON)

```json
{
  "items": [
    {
      "id": "xxx",
      "title": "スタッフ募集",
      "body": "<p>HTML本文</p>",
      "contentType": { "id": "xxx", "name": "お知らせ" },
      "fields": {
        "text0": "概要テキスト",
        "file0": "https://xxx.cloudfront.net/.../image.jpg",
        "flag0": true,
        "date0": "2026-02-21",
        "num0": 100
      },
      "createdAt": "2026-02-21T00:00:00Z",
      "updatedAt": "2026-02-21T00:00:00Z"
    }
  ],
  "total": 42,
  "page": 1,
  "limit": 10
}
```

### セキュリティ

- GETのみ受付（POST/PUT/DELETE は404）
- パラメータバリデーション: 英数字・ハイフン・アンダーバーのみ許可、それ以外は400
- CORS: 全て許可（利便性優先）

### embed.js の動作

```
1. 自身のscriptタグのsrc URLからパラメータを取得
2. 同一オリジンのAPIを叩く
3. サーバー側で Handlebars テンプレート適用済みHTMLを生成
4. target要素にinnerHTMLで描画
   - マッチする記事が0件の場合、何も出力しない
```

embed.js自体は軽量（fetch + innerHTMLのみ）。テンプレートレンダリングはサーバーサイド(SSR)で完結。

### 利用方法の3段階

| 方法 | SEO | 難易度 | 用途 |
|------|-----|--------|------|
| `embed.js` (script埋め込み) | × | ★☆☆ NoCode | お知らせ、バナー、ティッカー等 |
| `/render` (HTML直接取得) | ○ | ★★☆ PHP1行 | SEO重要なコンテンツ |
| `/items` (JSON API) | ○ | ★★★ 自前描画 | 完全カスタム表示 |

**利用例:**

```html
<!-- embed.js: NoCodeで静的サイトに埋め込み -->
<div id="cms-news"></div>
<script src="https://xxx.cloudfront.net/api/v1/sites/{siteId}/embed.js?contentType=news&template=list"></script>
```

```php
<?php
// /render: SEO対応がPHP1行で完結
echo file_get_contents('https://xxx.cloudfront.net/api/v1/sites/{siteId}/render?contentType=news&template=list');
?>
```

```php
<?php
// /items: JSONを取得して自由に描画
$json = file_get_contents('https://xxx.cloudfront.net/api/v1/sites/{siteId}/items?contentType=news');
$data = json_decode($json, true);
foreach ($data['items'] as $item) {
    echo "<h3>{$item['title']}</h3>";
}
?>
```

---

## 7. ライブデモ

以下のサンプルページで embed.js の動作を確認できます（GitHub Pages でホスト）。

| ページ | URL |
|--------|-----|
| お知らせ（list-modal テンプレート） | https://okamoto53515606.github.io/newcleus/embed-samples/news.html |
| フォトギャラリー（slideshow テンプレート） | https://okamoto53515606.github.io/newcleus/embed-samples/photogallery.html |

> データは CloudFront (`d1sax4j5hw821p.cloudfront.net`) の検証環境に接続しています。

---

## 8. 開発環境

- **開発マシン:** WSL (Ubuntu 22)
- **IDE:** VS Code + GitHub Copilot (Claude Sonnet 4.6)
- **実行環境とデプロイ:** setup画面からCDKデプロイ（ローカル `next dev`）
- **newcleusプロジェクト:** homepageとは**完全に別プロジェクト**を新規作成（一切干渉しない）
- **ドメイン:** xxx.cloudfront.net（独自ドメイン無し）

---

## 9. 活用パターン集

newcleusは「記事CMS」だが、汎用フィールド (text0-9, file0-9, flag0-9, date0-9, num0-9) とembed.jsの組み合わせで、記事以外の様々なコンテンツ管理に応用できる。以下は実績・想定の活用パターン。

### 9.1 実績あり

#### フォトギャラリー
- 1記事 = 1枚の写真カード。file0=写真、text0=キャプション
- embed.jsでインデックスをずらしながら1件ずつ取得 → スライドショー/カルーセル表示
- **API設計への示唆:** オフセット指定 (`offset` param) で任意の1件取得をサポートする

#### 動的HTMLパーツ（ページ名取得）
- 記事にtext0=ページ名属性を付与。ページ名でAPI呼び出し → 該当記事のHTMLを取得
- 例: プライバシーポリシー、特定商取引法表記等、頻繁に更新される静的ページをCMSから動的取得
- **API設計への示唆:** フィールド値での検索 (`text0=privacy-policy`) をサポートする

### 9.2 新規想定

| パターン | 記事の意味 | 主なフィールド | embed.jsの表現 |
|----------|-------------|---------------------|------------------------|
| **お知らせティッカー** | 1件=1お知らせ | flag0=緊急, date0=掲載日 | サイトヘッダーに流れるティッカー。flag0=1は赤帯表示 |
| **スタッフ紹介** | 1件=1人 | file0=写真, text0=役職, text1=コメント | カード型レイアウト |
| **FAQ** | 1件=1問答 | title=質問, body=回答, num0=表示順 | アコーディオンUI |
| **バナー管理** | 1件=1バナー | file0=画像, text0=リンクURL, date0=開始日, date1=終了日, num0=表示順 | 日付フィルタで自動出し分け |
| **施工事例 / Before・After** | 1件=1事例 | file0=Before, file1=After, text0=説明 | スライダー比較UI |
| **メニュー/料金表** | 1件=1メニュー | text0=メニュー名, num0=価格, flag0=おすすめ | テーブル/リスト表示 |
| **イベントカレンダー** | 1件=1イベント | date0=開催日, text0=場所, flag0=受付中 | date0ソートで直近イベント表示 |

### 9.3 API設計へのフィードバック

上記パターンを実現するために、公開APIに以下のパラメータをサポートする（基本設計に追加）:

```
GET /api/v1/sites/{siteId}/items
  &offset={number}           ⇐ フォトギャラリー用（インデックス指定で任意の1件取得）
  &text0={value}             ⇐ ページ名取得用（テキストフィールド完全一致）
  &date0_from=YYYY-MM-DD     ⇐ バナー・イベント用（日付範囲フィルタ）
  &date0_to=YYYY-MM-DD
  &sort_by={key}             ⇐ ソートキー指定（num0 / date0 / createdAt のいずれか）
```

