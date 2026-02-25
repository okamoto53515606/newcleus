# newcleus — データベース設計書 v0.0.3

Firestore データベース設計。Nucleus CMS の設計思想 (blog/item/contentType/member/team/MyShowBlogs汎用フィールド) を Firestore ネイティブに翻訳したもの。

---

## コレクション一覧

| コレクション | 用途 | Nucleus対応 |
|-------------|------|-------------|
| `sites` | サイト（テナント）管理 | `cmsnucleus_blog` |
| `sites/{siteId}/contentTypes` | コンテンツタイプ（汎用マスタ） | `cmsnucleus_category` + `cmsnucleus_plugin_option_desc` (一部) |
| `sites/{siteId}/contentTypes/{ctId}/templates` | 表示テンプレート (Handlebars) | `cmsnucleus_template` |
| `sites/{siteId}/items` | 記事 | `cmsnucleus_item` + `cmsnucleus_plugin_myshowblogs` |
| `users` | ユーザープロフィール（権限情報なし） | `cmsnucleus_member` |

---

## 1. sites コレクション

サイト（テナント）単位の管理情報。Nucleusの `blog` テーブルに相当。

- **コレクションパス:** `/sites`
- **ドキュメントID:** 自動生成ID

### フィールド

| フィールド名 | データ型 | 必須 | 説明 | Nucleus対応 |
|-------------|----------|------|------|-------------|
| `name` | `string` | ○ | サイト表示名 (例: "サンプルクリニック") | `bname` |
| `shortname` | `string` | ○ | URL識別用の短縮名 (英数字ハイフン, 例: "sample-clinic") | `bshortname` |
| `allowedOrigins` | `array of string` | ○ | CORS許可オリジン (例: `["https://sample-clinic.com"]`) | — |
| `adminUsers` | `array of map` | ○ | サイト管理者一覧 (後述) | `cmsnucleus_team` |
| `createdAt` | `timestamp` | ○ | 作成日時 | — |
| `updatedAt` | `timestamp` | ○ | 更新日時 | — |

### adminUsers 配列の構造

サイトに紐づく管理者（siteadmin）の一覧。招待時に pending で追加され、Googleログイン完了後に active に更新される。

| フィールド名 | データ型 | 必須 | 説明 |
|-------------|----------|------|------|
| `uid` | `string` | — | Firebase Auth uid（未登録時は空） |
| `email` | `string` | ○ | 招待先Gmailアドレス |
| `displayName` | `string` | — | 表示名（登録後に設定） |
| `status` | `string` | ○ | `"pending"` (招待中) / `"active"` (登録済み) |

**例:**
```json
{
  "adminUsers": [
    { "uid": "abc123", "email": "user@gmail.com", "displayName": "田中太郎", "status": "active" },
    { "email": "newuser@gmail.com", "status": "pending" }
  ]
}
```

### インデックス

| フィールド | 方向 | 用途 |
|-----------|------|------|
| `shortname` | ASC | shortname によるサイト検索 (ユニーク制約はアプリ層で担保) |

---

## 2. contentTypes サブコレクション

サイト内のコンテンツタイプ（汎用マスタ）定義。Nucleusの `category` テーブル + `plugin_option_desc` テーブルを統合。
各コンテンツタイプが独自のフィールド構成を持ち、記事のスキーマを定義する。

- **コレクションパス:** `/sites/{siteId}/contentTypes`
- **ドキュメントID:** 自動生成ID

### フィールド

| フィールド名 | データ型 | 必須 | 説明 | Nucleus対応 |
|-------------|----------|------|------|-------------|
| `name` | `string` | ○ | コンテンツタイプ名 (例: "お知らせ", "求人情報") | `cname` |
| `shortname` | `string` | ○ | API用識別名 (英数字ハイフン, 例: "news") | `cname` (英名) |
| `sortOrder` | `number` | ○ | 表示順 (小さい順) | — |
| `fieldLabels` | `map` | — | 汎用フィールドのラベル定義 (後述) | `cmsnucleus_plugin_option_desc` |
| `createdAt` | `timestamp` | ○ | 作成日時 | — |

### fieldLabels マップ

管理画面のフォーム自動生成に使用する汎用フィールドのラベル定義。
ラベルが定義されているフィールドのみ管理画面の入力フォームに表示する。未定義のフィールドは非表示。

| キー | データ型 | 説明 |
|------|----------|------|
| `text0` 〜 `text9` | `string` | textフィールドのラベル (例: "概要") |
| `file0` 〜 `file9` | `string` | fileフィールドのラベル (例: "メイン画像") |
| `flag0` 〜 `flag9` | `string` | flagフィールドのラベル (例: "公開フラグ") |
| `date0` 〜 `date9` | `string` | dateフィールドのラベル (例: "掲載開始日") |
| `num0` 〜 `num9` | `string` | numフィールドのラベル (例: "表示順") |

**例: 求人情報コンテンツタイプ**
```json
{
  "name": "求人情報",
  "shortname": "recruit",
  "sortOrder": 2,
  "fieldLabels": {
    "text0": "募集概要",
    "text1": "給与・待遇",
    "text3": "勤務時間",
    "text4": "休日",
    "text5": "福利厚生",
    "text6": "応募方法",
    "file0": "募集画像",
    "flag0": "トップ表示"
  },
  "createdAt": "2026-02-21T00:00:00Z"
}
```

---

## 3. templates サブコレクション

コンテンツタイプに紐づく表示テンプレート。embed.jsでサーバーサイドレンダリング(SSR)に使用。
Nucleusの `template` テーブルに相当。

- **コレクションパス:** `/sites/{siteId}/contentTypes/{contentTypeId}/templates`
- **ドキュメントID:** 自動生成ID

### フィールド

| フィールド名 | データ型 | 必須 | 説明 | Nucleus対応 |
|-------------|----------|------|------|-------------|
| `name` | `string` | ○ | テンプレート名 (例: "お知らせ一覧", "ティッカー") | `tdname` |
| `shortname` | `string` | ○ | API用識別名 (英数字ハイフン, 例: "list", "ticker") | — |
| `body` | `string` | ○ | HandlebarsテンプレートHTML | `tparttype` (BODY等) |
| `isDefault` | `boolean` | ○ | デフォルトテンプレートか | — |
| `createdAt` | `timestamp` | ○ | 作成日時 | — |
| `updatedAt` | `timestamp` | ○ | 更新日時 | — |

### テンプレートエンジン

- **Handlebars** を使用（Mustache互換 + `{{#if}}`, `{{#each}}`, `{{#unless}}`, `{{#with}}`, カスタムヘルパー対応）
- サーバーサイド(Node.js)でレンダリングし、完成HTMLをembed.jsに返却

### 利用可能な変数

| 変数 | 型 | 説明 |
|------|------|------|
| `items` | `array` | 条件にマッチした記事リスト。各要素は `title`, `body`, `fields.*`, `createdAt`, `updatedAt` 等全項目 |
| `item` | `object` | 先頭1件の記事。単一記事表示用のショートカット |

※ 条件にマッチする記事が0件の場合、embed.jsは何も出力しない

### セキュリティ

- テンプレート保存時に `<script>` タグ・`on*` イベント属性をサニタイズ除去
- `{{{body}}}` (エスケープなし出力) は記事本文のHTML表示用に許可

### テンプレート例

**お知らせ一覧:**
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

**単一ページ:**
```handlebars
{{#with item}}
<article>
  <h2>{{title}}</h2>
  <div>{{{body}}}</div>
</article>
{{/with}}
```

---

## 4. items サブコレクション

記事データ。Nucleusの `item` テーブル + `plugin_myshowblogs` テーブルを統合。

- **コレクションパス:** `/sites/{siteId}/items`
- **ドキュメントID:** 自動生成ID

### フィールド

| フィールド名 | データ型 | 必須 | 説明 | Nucleus対応 |
|-------------|----------|------|------|-------------|
| `title` | `string` | ○ | 記事タイトル | `imore` (※旧システムではimoreにタイトルを格納していた) |
| `body` | `string` | ○ | 記事本文 (HTML, TinyMCE出力) | `ibody` |
| `contentTypeId` | `string` | ○ | コンテンツタイプのドキュメントID | `icat` |
| `status` | `string` | ○ | `"published"` or `"draft"` | `idraft` (0/1の反転) |
| `authorUid` | `string` | ○ | 作成者のFirebase Auth uid | `iauthor` |
| `fields` | `map` | — | 汎用フィールド (後述) | `plugin_myshowblogs` テーブル |
| `createdAt` | `timestamp` | ○ | 作成日時 | `itime` |
| `updatedAt` | `timestamp` | ○ | 更新日時 | — |

### fields マップ (汎用フィールド)

Nucleusの `cmsnucleus_plugin_myshowblogs` テーブルが持っていた汎用フィールドをFirestoreのマップで表現。
コンテンツタイプの `fieldLabels` で定義されたフィールドのみ使用する。

| キー | データ型 | 説明 | Nucleus対応 |
|------|----------|------|-------------|
| `text0` 〜 `text9` | `string` | テキストフィールド | `text0` 〜 `text9` |
| `file0` 〜 `file9` | `string` | ファイルURL (Firebase Storage) | `file0` 〜 `file9` |
| `flag0` 〜 `flag9` | `boolean` | フラグ | `flag0` 〜 `flag9` (0/1) |
| `date0` 〜 `date9` | `timestamp` | 日付 | `date0` 〜 `date9` |
| `num0` 〜 `num9` | `number` | 数値 | `num0` 〜 `num9` |

**例: 求人情報コンテンツタイプの記事**
```json
{
  "title": "受付医療事務 募集中",
  "body": "<p>仲間達とそれぞれの夢に向かって...</p>",
  "contentTypeId": "xxx",
  "status": "published",
  "authorUid": "yyy",
  "fields": {
    "text0": "仲間達とそれぞれの夢に向かってがんばりましょう！...",
    "text1": "【正社員】(1)受付医療事務...",
    "text3": "実働8時間（月・火・水）...",
    "text4": "●正職員：木曜午後...",
    "text5": "●社会保険完備...",
    "text6": "電話連絡の上...",
    "file0": "https://storage.googleapis.com/.../recruit-photo.jpg",
    "flag0": true
  },
  "createdAt": "2026-02-21T00:00:00Z",
  "updatedAt": "2026-02-21T00:00:00Z"
}
```

### インデックス

| フィールド | 方向 | 用途 |
|-----------|------|------|
| `status` ASC + `createdAt` DESC | 複合 | 公開記事一覧（新しい順） |
| `status` ASC + `contentTypeId` ASC + `createdAt` DESC | 複合 | コンテンツタイプ別公開記事一覧 |
| `status` ASC + `fields.flag0` ASC + `createdAt` DESC | 複合 | フラグフィルタ付き記事一覧 |

---

## 5. users コレクション

ユーザープロフィール。権限情報は保持せず、Firebase Auth Custom Claims のみで管理。

- **コレクションパス:** `/users`
- **ドキュメントID:** Firebase Auth の `uid`

### フィールド

| フィールド名 | データ型 | 必須 | 説明 | Nucleus対応 |
|-------------|----------|------|------|-------------|
| `uid` | `string` | ○ | Firebase Auth uid | `mnumber` |
| `email` | `string` | ○ | Gmailアドレス | `memail` |
| `displayName` | `string` | — | 表示名 | `mrealname` |
| `photoURL` | `string` | — | Googleプロフィール画像URL | — |
| `createdAt` | `timestamp` | ○ | アカウント作成日時 | — |
| `updatedAt` | `timestamp` | ○ | 最終更新日時 | — |

※ 権限情報 (`role`, `siteIds`) は一切保持しない。Firebase Auth Custom Claims が唯一の権限ソース。

### Firebase Auth Custom Claims（権限管理の唯一のソース）

**admin（スーパー管理者）:**
```json
{ "role": "admin" }
```
- CLIで付与（`firebase functions:shell` 等で `setCustomUserClaims`）
- 全サイトにアクセス可、siteIds不要

**siteadmin（サイト管理者）:**
```json
{ "role": "siteadmin", "siteIds": ["siteId1", "siteId2"] }
```
- 招待フローで自動付与
- `siteIds` に含まれるサイトのみ操作可能
- 複数サイトの紐づけ可能（Claims上限 1000バイト、実用上数十サイトまで可）

### ロール定義

| ロール | 権限 | 付与方法 | Nucleus対応 |
|--------|------|----------|-------------|
| `admin` | 全サイト管理、サイト作成/削除、siteadmin招待 | CLIでCustom Claims設定 | `madmin=1` |
| `siteadmin` | 紐づくサイトのコンテンツタイプ・記事管理 | 招待フローでCustom Claims設定 | `tadmin` (team内) |

---

## 6. Firebase Storage 構造

```
sites/
  {siteId}/
    items/
      {itemId}/
        {timestamp}-{filename}.jpg    ← TinyMCE本文内の画像
    fields/
      {itemId}/
        {fieldName}-{timestamp}-{filename}.jpg  ← 汎用フィールド (file0等) の画像
```

### Storage Rules

```
match /sites/{siteId}/{allPaths=**} {
  allow read: if true;                              // 公開情報のため誰でも読める
  allow write: if request.auth != null
    && (request.auth.token.role == 'admin'           // adminは全サイト書込み可
        || request.auth.token.siteIds.hasAny([siteId])); // siteadminは担当サイトのみ
}
```

---

## 7. Nucleus → Firestore フィールドマッピング早見表

### item テーブル

| Nucleus (item) | Firestore (items) | 備考 |
|----------------|-------------------|------|
| `inumber` | ドキュメントID (自動) | — |
| `ititle` | (未使用) | 旧システムではititleは空だった |
| `ibody` | `body` | HTML本文 |
| `imore` | `title` | 旧システムではimoreにタイトルを格納 |
| `iblog` | 親コレクション `sites/{siteId}` | サブコレクションで自然に分離 |
| `iauthor` | `authorUid` | Firebase Auth uid |
| `itime` | `createdAt` | Timestamp型 |
| `idraft` | `status` | 0→"published", 1→"draft" |
| `icat` | `contentTypeId` | コンテンツタイプID |
| `iclosed` | (廃止) | コメント機能なし |
| `ikarmapos/neg` | (廃止) | karma機能なし |

### plugin_myshowblogs テーブル

| Nucleus | Firestore | 備考 |
|---------|-----------|------|
| `text0`〜`text9` | `fields.text0`〜`fields.text9` | string |
| `file0`〜`file9` | `fields.file0`〜`fields.file9` | Storage URL (string) |
| `flag0`〜`flag9` | `fields.flag0`〜`fields.flag9` | boolean (0/1 → true/false) |
| `date0`〜`date9` | `fields.date0`〜`fields.date9` | timestamp |
| `num0`〜`num9` | `fields.num0`〜`fields.num9` | number |
| `textindex` | (廃止) | フリーワード検索なし |

---

## 8. 廃止するNucleusテーブル

| テーブル | 理由 |
|---------|------|
| `cmsnucleus_actionlog` | 不要 (Firebaseのログで代替) |
| `cmsnucleus_activation` | 不要 (Google OAuth) |
| `cmsnucleus_ban` | 不要 |
| `cmsnucleus_comment` | コメント機能なし |
| `cmsnucleus_config` | 不要 (Firebase設定で代替) |
| `cmsnucleus_karma` | 不要 |
| `cmsnucleus_plugin` | 不要 (プラグイン機構廃止) |
| `cmsnucleus_plugin_event` | 不要 |
| `cmsnucleus_plugin_option` | contentTypes.fieldLabels で代替 |
| `cmsnucleus_plugin_option_desc` | contentTypes.fieldLabels で代替 |
| `cmsnucleus_skin` | templates サブコレクションで代替 |
| `cmsnucleus_skin_desc` | templates サブコレクションで代替 |
| `cmsnucleus_template` | templates サブコレクションで代替 |
| `cmsnucleus_template_desc` | templates サブコレクションで代替 |
| `cmsnucleus_tickets` | 不要 (Firebase Auth Session) |
