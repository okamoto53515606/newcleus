# newcleus — Blueprint v0.0.2

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
│  └── owner: userA@gmail     └── owner: userB@gmail    │
│                                                       │
│  ※ 利用者Aは自分のサイトAの記事のみ見える・操作できる  │
│  ※ 利用者Bは自分のサイトBの記事のみ見える・操作できる  │
│  ※ superadmin（運営者）は全サイトを管理できる          │
└───────────────────────────────────────────────────────┘
```

- Nucleusでは `blog` テーブルがこのテナント単位だった（1 blog = 1利用者の記事リスト）
- 新CMSでは Firestore の `sites/{siteId}` コレクションがこれに相当する
- 利用者追加 = サイト作成 + Googleアカウント紐づけ で完了

### 基本情報

- **想定規模:** 年間20サイト未満
- **旧資産:** 20年前のNucleus CMS（PHP）の設計思想・DB設計 + 1ヵ月前のFirebase個人メディア「homepage」のコード資産
- **新技術スタック:** Next.js (TypeScript) + Firebase (Firestore / Storage / Auth / App Hosting)

---

## 2. アーキテクチャ

```
┌──────────────────────────────────────────────────────────┐
│  管理画面 (Next.js App Router)                             │
│  - Firebase App Hosting でデプロイ                         │
│  - Google OAuth ログイン (homepage資産から流用)             │
│  - TinyMCE 7 Core エディタ (HTML出力)                      │
│  - 画像: browser-image-compression → Firebase Storage      │
│  - サーバーサイド: Admin SDK でFirestore読み書き            │
│  - Firestore Security Rules は全拒否（Admin SDKのみ通す）  │
└──────────────┬───────────────────────────────────────────┘
               │
┌──────────────▼───────────────────────────────────────────┐
│  Firebase                                                 │
│  Firestore: サイト・記事・コンテンツタイプ・ユーザー       │
│  Storage:   画像ファイル (CDN配信)                         │
│  Auth:      Google OAuth + Custom Claims (admin/owner)     │
└──────────────┬───────────────────────────────────────────┘
               │
┌──────────────▼───────────────────────────────────────────┐
│  公開API (Next.js API Routes)                              │
│  GET /api/v1/sites/{siteId}/items  → JSON                  │
│  GET /api/v1/sites/{siteId}/items/{itemId}  → JSON         │
│  GET /api/v1/sites/{siteId}/embed.js → scriptタグ埋め込みJS│
│  - CORSはサイト別 allowedOrigins で動的制御                │
│  - GET only / パラメータは英数字ハイフンアンダーバーのみ    │
│  - POST受付なし / 全て公開情報                             │
└─────────────────────────────────────────────────────────┘

利用者サイト (任意のHTML):
  <div id="cms-news"></div>
  <script src="https://easycms.okamomedia.tokyo/api/v1/sites/{siteId}/embed.js?contentType=news&limit=5"></script>
```

---

## 3. homepageから流用する資産

| 資産 | ファイル | 流用度 |
|------|----------|--------|
| Google OAuth フロー | `src/components/auth/auth-provider.tsx`, `src/app/api/auth/session/route.ts`, `src/lib/auth.ts` | そのまま |
| Firebase Admin SDK 初期化 | `src/lib/firebase-admin.ts` | そのまま |
| Client SDK 初期化 | `src/lib/firebase.ts` | そのまま |
| 画像アップロード | `article-generator-form.tsx` 内の Storage upload 処理 | 抽出して共通化 |
| HttpOnly Session Cookie | `/api/auth/session` | そのまま |
| Admin Layout + ロールチェック | `src/app/admin/layout.tsx`, `src/lib/auth.ts` の `getUser()` | role拡張 |
| apphosting.yaml | `apphosting.yaml` | そのまま |
| Firestore Rules (全拒否) | `firestore.rules` | そのまま |

### 削除するもの (homepageにあってCMSに不要)

- Stripe決済関連 (`src/lib/stripe.ts`, `src/app/api/stripe/`, `src/app/payment/`)
- AI記事生成 (`src/ai/`, Genkit関連)
- コメント機能 (`comments` コレクション, `src/components/comment-section.tsx`)
- 記事公開ページ (`src/app/articles/`)
- Markdown関連 (`react-markdown`, `remark-gfm`)
- IP制限middleware（SaaSでは不要、ロールチェックで代替）

---

## 4. Nucleusから引き継ぐ設計思想

| Nucleus の概念 | 新CMS での対応 |
|----------------|----------------|
| blog (テナント単位) | `sites/{siteId}` コレクション |
| item (記事) | `sites/{siteId}/items/{itemId}` サブコレクション |
| category | `sites/{siteId}/contentTypes/{contentTypeId}` サブコレクション |
| member + team (ユーザーとブログの紐づけ) | `users/{uid}.siteIds[]` + Custom Claims |
| MyShowBlogsの汎用フィールド (text0-9, file0-9, flag0-9, date0-9, num0-9) | `items/{itemId}.fields` マップ |
| MyShowBlogsのフィールド定義 (plugin_option_desc) | `contentTypes/{contentTypeId}.fieldLabels` マップ |
| MyShowBlogsのフィルタ (flag0=1等) | 公開APIのクエリパラメータ |
| iframe埋め込み | scriptタグ埋め込み (embed.js) に進化 |
| テンプレート (skin/template) | embed.js + 利用者サイト側のCSS/JS に委ねる |

---

## 5. 管理画面の機能一覧

### 5.1 認証・ユーザー管理

- Googleログインのみ（独自パスワードなし）
- ロール: `superadmin`（システム管理者）/ `owner`（サイトオーナー）/ `editor`（編集者）
- superadminがサイト作成 + ownerのGmailアドレスを紐づけ
- ownerがeditorを追加可能
- Custom Claims に `role` と `siteIds` を格納

### 5.2 サイト管理 (superadmin)

- サイト作成: name, shortname, ownerEmail, allowedOrigins
- サイト作成時にFirestoreにドキュメント + 初期コンテンツタイプ自動生成
- サイト一覧・編集・削除

### 5.3 コンテンツタイプ管理 (owner)

- コンテンツタイプCRUD (name, shortname, sortOrder, fieldLabels)
- コンテンツタイプ別の汎用フィールドラベル定義 (fieldLabelsマップ)
  - 例: text0 = "概要", file0 = "メイン画像", flag0 = "公開フラグ"
  - ラベル未定義のフィールドは管理画面に表示しない

### 5.4 記事管理 (owner / editor)

- 記事一覧（自サイトの記事のみ表示）
- 記事作成・編集
  - タイトル入力
  - TinyMCE 7 Core でHTML本文編集（画像埋め込み対応）
  - コンテンツタイプ選択
  - 汎用フィールド入力（コンテンツタイプのfieldLabels定義に基づき動的フォーム生成）
    - text: テキストエリア
    - file: 画像アップロード（Firebase Storage）
    - flag: チェックボックス
    - date: 日付ピッカー
    - num: 数値入力
  - 公開/下書き切り替え
- 記事削除

### 5.5 WYSIWYGエディタ

- TinyMCE 7 Core（MIT License）
- 最低限の装飾: 太字、イタリック、リンク、箇条書き、見出し(h2-h4)
- 画像挿入: アップロードボタン → browser-image-compression (1MB/1024px上限) → Firebase Storage → URL挿入
- HTML出力をそのままFirestoreに保存
- カスタムプラグイン不要、標準機能のみ

---

## 6. 公開API仕様

### エンドポイント

```
GET /api/v1/sites/{siteId}/items
  ?contentType={contentTypeId}  コンテンツタイプフィルタ (任意)
  &limit={number}           取得件数 (デフォルト10, 最大100)
  &page={number}            ページ番号 (デフォルト1)
  &sort={order}             日付ソート (desc または asc, デフォルトdesc)
  &flag0=1                  汎用フラグフィルタ (任意, flag0-flag9)

GET /api/v1/sites/{siteId}/items/{itemId}
  単一記事取得

GET /api/v1/sites/{siteId}/embed.js
  ?target={elementId}       描画先DOM要素ID (デフォルト "cms-content")
  &contentType={contentTypeId}  コンテンツタイプフィルタ (任意)
  &limit={number}           表示件数 (デフォルト5)
  &flag0=1                  汎用フラグフィルタ (任意)
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
        "file0": "https://storage.googleapis.com/.../image.jpg",
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
- CORS: `sites/{siteId}.allowedOrigins` に登録されたドメインのみ `Access-Control-Allow-Origin` を返す
- Rate Limiting: 将来的にFirebase App Hosting側で設定（初期は不要）

### embed.js の動作

```javascript
// 1. 自身のscriptタグのsrc URLからパラメータを取得
// 2. 同一オリジンのAPIを叩いてJSON取得
// 3. target要素にHTMLを描画（リスト表示 + 詳細リンク）
// 4. CSSは最小限のデフォルトスタイルを注入（利用者サイト側で上書き可能）
```

---

## 7. 開発フェーズ

| Phase | 内容 | 前提 |
|-------|------|------|
| **1** | プロジェクト雛形作成 | homepageからfork → 不要物削除 → Firestore schema定義 → Firebase新プロジェクト作成 |
| **2** | 管理画面: サイト管理CRUD + コンテンツタイプ管理CRUD | Phase 1完了 |
| **3** | 管理画面: 記事CRUD + TinyMCEエディタ + 画像アップロード + 汎用フィールド | Phase 2完了 |
| **4** | 公開API: JSON API + CORSハンドリング | Phase 3完了 |
| **5** | 公開API: embed.js (scriptタグ埋め込み) | Phase 4完了 |
| **6** | テナント管理: サイト作成時の自動セットアップ + owner招待フロー | Phase 4完了 |
| **7** | コンテンツタイプのfieldLabels定義 + 動的フォーム生成 | Phase 3完了 |

**Phase 1→3 で管理画面MVP、Phase 4→5 で公開配信MVP。**

---

## 8. 開発環境

- **開発マシン:** WSL (Ubuntu 22)
- **IDE:** VS Code + GitHub Copilot (Claude)
- **実行環境:** Firebase Studio からデプロイ or ローカル `next dev`
- **デプロイ:** Firebase App Hosting (`git push` → 自動ビルド・デプロイ)
- **Firebaseプロジェクト:** homepageとは**完全に別プロジェクト**を新規作成（一切干渉しない）
- **ドメイン:** `newcleus.okamomedia.tokyo` (メディア本体は `www.okamomedia.tokyo`)

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

---

## 10. 参照資料 `.sample-files`配下

- 旧NucleusDB: testcms1のmysqldump
- homepage資産: `homepage/` 配下
- homepage blueprint: `homepage/docs/blueprint.md`
- homepage DB設計: `homepage/docs/database-schema.md`
