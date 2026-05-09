# newcleus — データベース設計書 v0.1.0

DynamoDB データベース設計。Nucleus CMS の設計思想 (blog/item/contentType/member/team/MyShowBlogs汎用フィールド) を DynamoDB ネイティブに翻訳したもの。

---

## テーブル一覧

| テーブル名 | 用途 | Nucleus対応 |
|-----------|------|-------------|
| `newcleus-sites` | サイト（テナント）管理 | `cmsnucleus_blog` |
| `newcleus-content-types` | コンテンツタイプ（汎用マスタ）定義 | `cmsnucleus_category` + `cmsnucleus_plugin_option_desc` |
| `newcleus-templates` | 表示テンプレート (Handlebars) | `cmsnucleus_template` |
| `newcleus-items` | 記事 | `cmsnucleus_item` + `cmsnucleus_plugin_myshowblogs` |

---

## リージョン

**ap-northeast-1（東京）**

---

## 1. newcleus-sites テーブル

サイト（テナント）単位の管理情報。Nucleusの `blog` テーブルに相当。

- **テーブル名**: `newcleus-sites`
- **キー設計**: PK のみ

| キー | 属性名 | 型 | 値 |
|------|--------|----|----|
| PK | `siteId` | `S` | UUID |

### 属性

| 属性名 | 型 | 必須 | 説明 | Nucleus対応 |
|--------|-----|------|------|-------------|
| `siteId` | `S` | ○ | PK。UUID | — |
| `name` | `S` | ○ | サイト表示名 (例: "サンプルクリニック") | `bname` |
| `shortname` | `S` | ○ | URL識別用の短縮名 (英数字ハイフン, 例: "sample-clinic") | `bshortname` |
| `adminUsers` | `L` | ○ | サイト管理者一覧（`M` のリスト。後述） | `cmsnucleus_team` |
| `createdAt` | `S` | ○ | 作成日時（ISO 8601） | — |
| `updatedAt` | `S` | ○ | 更新日時（ISO 8601） | — |

### adminUsers リストの構造

サイトに紐づく管理者（siteadmin）の一覧。招待時に `pending` で追加され、Cognitoアカウント登録完了後に `active` に更新される。

| 属性名 | 型 | 必須 | 説明 |
|--------|-----|------|------|
| `userId` | `S` | — | Cognito の `sub`（未登録時は空文字） |
| `email` | `S` | ○ | 招待先メールアドレス |
| `status` | `S` | ○ | `"pending"` (招待中) / `"active"` (登録済み) |

**例:**
```json
{
  "adminUsers": [
    { "userId": "abc123", "email": "user@example.com", "status": "active" },
    { "email": "newuser@example.com", "status": "pending" }
  ]
}
```

### GSI（グローバルセカンダリインデックス）

#### GSI1: `sites-by-shortname`

shortname でサイトを一意に取得する（ユニーク制約の確認用）。

| キー | 属性名 | 型 | 説明 |
|------|--------|-----|------|
| GSI1-PK | `shortname` | `S` | URL識別用短縮名 |

**投影**: ALL（全属性を射影）

### アクセスパターン

| # | 操作 | アクセス方法 | 用途 |
|---|------|-------------|------|
| 1 | GetItem | PK=`{siteId}` | サイト取得（管理画面・API認証） |
| 2 | Query (GSI1) | PK=`{shortname}` | shortname でサイト取得（ユニーク確認） |
| 3 | Scan | — | 全サイト一覧（admin用。サイト数が少ないためスキャンで対応） |
| 4 | PutItem | PK=`{siteId}` | サイト作成 |
| 5 | UpdateItem | PK=`{siteId}` | サイト更新 / adminUsers 更新 |
| 6 | DeleteItem | PK=`{siteId}` | サイト削除 |

---

## 2. newcleus-content-types テーブル

サイト内のコンテンツタイプ（汎用マスタ）定義。Nucleusの `category` テーブル + `plugin_option_desc` テーブルを統合。

- **テーブル名**: `newcleus-content-types`
- **キー設計**: 複合キー

| キー | 属性名 | 型 | 値 |
|------|--------|----|----|
| PK | `siteId` | `S` | 親サイトのUUID |
| SK | `ctId` | `S` | UUID |

### 属性

| 属性名 | 型 | 必須 | 説明 | Nucleus対応 |
|--------|-----|------|------|-------------|
| `siteId` | `S` | ○ | PK。親サイトのUUID | — |
| `ctId` | `S` | ○ | SK。UUID | — |
| `name` | `S` | ○ | コンテンツタイプ名 (例: "お知らせ", "求人情報") | `cname` |
| `shortname` | `S` | ○ | API用識別名 (英数字ハイフン, 例: "news") | `cname` (英名) |
| `sortOrder` | `N` | ○ | 表示順 (小さい順) | — |
| `fieldLabels` | `M` | — | 汎用フィールドのラベル定義（後述） | `cmsnucleus_plugin_option_desc` |
| `createdAt` | `S` | ○ | 作成日時（ISO 8601） | — |
| `updatedAt` | `S` | ○ | 更新日時（ISO 8601） | — |

### fieldLabels マップ

管理画面のフォーム自動生成に使用する汎用フィールドのラベル定義。
ラベルが定義されているフィールドのみ管理画面の入力フォームに表示する。未定義のフィールドは非表示。

| キー | 型 | 説明 |
|------|-----|------|
| `text0` 〜 `text9` | `S` | textフィールドのラベル (例: "概要") |
| `file0` 〜 `file9` | `S` | fileフィールドのラベル (例: "メイン画像") |
| `flag0` 〜 `flag9` | `S` | flagフィールドのラベル (例: "公開フラグ") |
| `date0` 〜 `date9` | `S` | dateフィールドのラベル (例: "掲載開始日") |
| `num0` 〜 `num9` | `S` | numフィールドのラベル (例: "表示順") |

**例: 求人情報コンテンツタイプ**
```json
{
  "siteId": "site-uuid-xxx",
  "ctId": "ct-uuid-yyy",
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
  "createdAt": "2026-02-21T00:00:00.000Z",
  "updatedAt": "2026-02-21T00:00:00.000Z"
}
```

### GSI（グローバルセカンダリインデックス）

#### GSI1: `content-types-by-shortname`

siteId + shortname でコンテンツタイプを取得する（API呼び出し時の shortname 解決用）。

| キー | 属性名 | 型 | 説明 |
|------|--------|-----|------|
| GSI1-PK | `siteId` | `S` | 親サイトのUUID |
| GSI1-SK | `shortname` | `S` | API用識別名 |

**投影**: ALL（全属性を射影）

### アクセスパターン

| # | 操作 | アクセス方法 | 用途 |
|---|------|-------------|------|
| 1 | Query | PK=`{siteId}` | サイトのコンテンツタイプ一覧 |
| 2 | GetItem | PK=`{siteId}`, SK=`{ctId}` | コンテンツタイプ取得 |
| 3 | Query (GSI1) | PK=`{siteId}`, SK=`{shortname}` | shortname でコンテンツタイプ取得 |
| 4 | PutItem | PK=`{siteId}`, SK=`{ctId}` | コンテンツタイプ作成 |
| 5 | UpdateItem | PK=`{siteId}`, SK=`{ctId}` | コンテンツタイプ更新 |
| 6 | DeleteItem | PK=`{siteId}`, SK=`{ctId}` | コンテンツタイプ削除 |

---

## 3. newcleus-templates テーブル

コンテンツタイプに紐づく表示テンプレート。embed.js でのサーバーサイドレンダリング(SSR)に使用。
Nucleusの `template` テーブルに相当。

- **テーブル名**: `newcleus-templates`
- **キー設計**: 複合キー

| キー | 属性名 | 型 | 値 |
|------|--------|----|----|
| PK | `ctId` | `S` | 親コンテンツタイプのUUID |
| SK | `templateId` | `S` | UUID |

### 属性

| 属性名 | 型 | 必須 | 説明 | Nucleus対応 |
|--------|-----|------|------|-------------|
| `ctId` | `S` | ○ | PK。親コンテンツタイプのUUID | — |
| `templateId` | `S` | ○ | SK。UUID | — |
| `siteId` | `S` | ○ | 親サイトのUUID | — |
| `name` | `S` | ○ | テンプレート名 (例: "お知らせ一覧", "ティッカー") | `tdname` |
| `shortname` | `S` | ○ | API用識別名 (英数字ハイフン, 例: "list", "ticker") | — |
| `body` | `S` | ○ | HandlebarsテンプレートHTML | `tparttype` (BODY等) |
| `createdAt` | `S` | ○ | 作成日時（ISO 8601） | — |
| `updatedAt` | `S` | ○ | 更新日時（ISO 8601） | — |

### テンプレートエンジン

- **Handlebars** を使用（Mustache互換 + `{{#if}}`, `{{#each}}`, `{{#unless}}`, `{{#with}}`, カスタムヘルパー対応）
- サーバーサイド(Node.js)でレンダリングし、完成HTMLをembed.jsに返却

### 利用可能な変数

| 変数 | 型 | 説明 |
|------|-----|------|
| `items` | `L` | 条件にマッチした記事リスト。各要素は `title`, `body`, `fields.*`, `createdAt`, `updatedAt` 等全項目 |
| `item` | `M` | 先頭1件の記事。単一記事表示用のショートカット |

※ 条件にマッチする記事が0件の場合、embed.jsは何も出力しない

### セキュリティ

- テンプレート保存時に `on*` イベント属性をサニタイズ除去（`<script>` タグは管理者記述の信頼済みコンテンツのため許可）
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

### GSI（グローバルセカンダリインデックス）

#### GSI1: `templates-by-shortname`

ctId + shortname でテンプレートを取得する（API呼び出し時の template 名解決用）。

| キー | 属性名 | 型 | 説明 |
|------|--------|-----|------|
| GSI1-PK | `ctId` | `S` | 親コンテンツタイプのUUID |
| GSI1-SK | `shortname` | `S` | API用識別名 |

**投影**: ALL（全属性を射影）

### アクセスパターン

| # | 操作 | アクセス方法 | 用途 |
|---|------|-------------|------|
| 1 | Query | PK=`{ctId}` | コンテンツタイプのテンプレート一覧 |
| 2 | GetItem | PK=`{ctId}`, SK=`{templateId}` | テンプレート取得 |
| 3 | Query (GSI1) | PK=`{ctId}`, SK=`{shortname}` | shortname でテンプレート取得（embed.js用） |
| 4 | PutItem | PK=`{ctId}`, SK=`{templateId}` | テンプレート作成 |
| 5 | UpdateItem | PK=`{ctId}`, SK=`{templateId}` | テンプレート更新 |
| 6 | DeleteItem | PK=`{ctId}`, SK=`{templateId}` | テンプレート削除 |

---

## 4. newcleus-items テーブル

記事データ。Nucleusの `item` テーブル + `plugin_myshowblogs` テーブルを統合。

- **テーブル名**: `newcleus-items`
- **キー設計**: 複合キー

| キー | 属性名 | 型 | 値 |
|------|--------|----|----|
| PK | `siteId` | `S` | 親サイトのUUID |
| SK | `itemId` | `S` | UUID |

### 属性

| 属性名 | 型 | 必須 | 説明 | Nucleus対応 |
|--------|-----|------|------|-------------|
| `siteId` | `S` | ○ | PK。親サイトのUUID | `iblog` |
| `itemId` | `S` | ○ | SK。UUID | `inumber` |
| `title` | `S` | ○ | 記事タイトル | `imore` (※旧システムではimoreにタイトルを格納していた) |
| `body` | `S` | ○ | 記事本文（HTML, TinyMCE出力） | `ibody` |
| `contentTypeId` | `S` | ○ | 親コンテンツタイプのUUID | `icat` |
| `status` | `S` | ○ | `"published"` or `"draft"` | `idraft` (0/1の反転) |
| `authorId` | `S` | ○ | 作成者の Cognito `sub` | `iauthor` |
| `fields` | `M` | — | 汎用フィールド（後述） | `plugin_myshowblogs` テーブル |
| `siteContentTypeKey` | `S` | ○ | `{siteId}#{contentTypeId}`（GSI2用。アプリ側で自動生成） | — |
| `createdAt` | `S` | ○ | 作成日時（ISO 8601） | `itime` |
| `updatedAt` | `S` | ○ | 更新日時（ISO 8601） | — |

### fields マップ (汎用フィールド)

Nucleusの `cmsnucleus_plugin_myshowblogs` テーブルが持っていた汎用フィールドをDynamoDBのマップで表現。
コンテンツタイプの `fieldLabels` で定義されたフィールドのみ使用する。

| キー | 型 | 説明 | Nucleus対応 |
|------|-----|------|-------------|
| `text0` 〜 `text9` | `S` | テキストフィールド | `text0` 〜 `text9` |
| `file0` 〜 `file9` | `S` | ファイルURL（S3 / CloudFront URL） | `file0` 〜 `file9` |
| `flag0` 〜 `flag9` | `BOOL` | フラグ | `flag0` 〜 `flag9` (0/1) |
| `date0` 〜 `date9` | `S` | 日付（ISO 8601） | `date0` 〜 `date9` |
| `num0` 〜 `num9` | `N` | 数値 | `num0` 〜 `num9` |

**例: 求人情報コンテンツタイプの記事**
```json
{
  "siteId": "site-uuid-xxx",
  "itemId": "item-uuid-zzz",
  "title": "受付医療事務 募集中",
  "body": "<p>仲間達とそれぞれの夢に向かって...</p>",
  "contentTypeId": "ct-uuid-yyy",
  "status": "published",
  "authorId": "cognito-sub-aaa",
  "siteContentTypeKey": "site-uuid-xxx#ct-uuid-yyy",
  "fields": {
    "text0": "仲間達とそれぞれの夢に向かってがんばりましょう！...",
    "text1": "【正社員】(1)受付医療事務...",
    "text3": "実働8時間（月・火・水）...",
    "text4": "●正職員：木曜午後...",
    "text5": "●社会保険完備...",
    "text6": "電話連絡の上...",
    "file0": "https://xxx.cloudfront.net/sites/site-uuid-xxx/fields/item-uuid-zzz/file0-20260221-recruit.jpg",
    "flag0": true
  },
  "createdAt": "2026-02-21T00:00:00.000Z",
  "updatedAt": "2026-02-21T00:00:00.000Z"
}
```

### GSI（グローバルセカンダリインデックス）

#### GSI1: `items-by-createdAt`

サイトの記事を作成日順に取得する（記事一覧・管理画面）。FilterExpressionで `status` と `contentTypeId` を絞り込む。

| キー | 属性名 | 型 | 説明 |
|------|--------|-----|------|
| GSI1-PK | `siteId` | `S` | 親サイトのUUID |
| GSI1-SK | `createdAt` | `S` | ISO 8601（ソートキー） |

**投影**: ALL（全属性を射影）

#### GSI2: `items-by-contentType-createdAt`

コンテンツタイプ別の記事を作成日順に取得する（公開APIのコンテンツタイプフィルタ）。

| キー | 属性名 | 型 | 説明 |
|------|--------|-----|------|
| GSI2-PK | `siteContentTypeKey` | `S` | `{siteId}#{contentTypeId}` の複合値（例: `"siteXXX#ctYYY"`） |
| GSI2-SK | `createdAt` | `S` | ISO 8601（ソートキー） |

**投影**: ALL（全属性を射影）

### アクセスパターン

| # | 操作 | アクセス方法 | 用途 |
|---|------|-------------|------|
| 1 | Query (GSI1) | PK=`{siteId}`, SK desc + FilterExpression: `status='published'` | 公開記事一覧（新しい順） |
| 2 | Query (GSI2) | PK=`{siteId}#{contentTypeId}`, SK desc + FilterExpression: `status='published'` | コンテンツタイプ別公開記事一覧 |
| 3 | GetItem | PK=`{siteId}`, SK=`{itemId}` | 記事ID指定で単一記事取得 |
| 4 | Query (GSI1) | PK=`{siteId}`, SK desc | 管理者用記事一覧（全ステータス） |
| 5 | PutItem | PK=`{siteId}`, SK=`{itemId}` | 記事作成 |
| 6 | UpdateItem | PK=`{siteId}`, SK=`{itemId}` | 記事更新 |
| 7 | DeleteItem | PK=`{siteId}`, SK=`{itemId}` | 記事削除 |

**ページネーション方式**: cursor-based（`ExclusiveStartKey`）を使用。

---

## 5. S3 バケット構造

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

CloudFront 経由でパブリック配信。URL例:
```
https://xxx.cloudfront.net/sites/{siteId}/items/{itemId}/20260221120000-photo.jpg
```

---

## 6. Cognito Custom Attributes（権限管理）

権限情報は DynamoDB には保持しない。Cognito Custom Attributes が唯一の権限ソース。

**admin（スーパー管理者）:**
```json
{ "custom:role": "admin" }
```
- setup画面で付与（Cognito Admin API で `AdminUpdateUserAttributes`）
- 全サイトにアクセス可、`custom:siteIds` 不要

**siteadmin（サイト管理者）:**
```json
{ "custom:role": "siteadmin", "custom:siteIds": "[\"siteId1\",\"siteId2\"]" }
```
- 招待フローで自動付与（Cognito Admin API で `AdminUpdateUserAttributes`）
- `custom:siteIds`（JSON文字列）に含まれるサイトのみ操作可能
- 複数サイトの紐づけ可能（Custom Attributes の上限 2048バイト。実用上数十サイトまで可）

### ロール定義

| ロール | 権限 | 付与方法 | Nucleus対応 |
|--------|------|----------|-------------|
| `admin` | 全サイト管理、サイト作成/削除、siteadmin招待 | setup画面でCustom Attributes設定 | `madmin=1` |
| `siteadmin` | 紐づくサイトのコンテンツタイプ・記事管理 | 招待フローでCustom Attributes設定 | `tadmin` (team内) |

---

## 7. テーブル容量モード

全テーブル **オンデマンドモード**（PAY_PER_REQUEST）を使用する。

理由：
- 年間20サイト未満の規模ではリクエスト数が少なく予測しづらい
- プロビジョニングモードのキャパシティ管理が不要
- コストは使った分だけ（アクセスがなければ 0 円）

---

## 8. データ型

| DynamoDB 型 | 説明 |
|--------------|------|
| `S` | 文字列（timestamp は ISO 8601 文字列で保存。例: `2026-02-21T00:00:00.000Z`） |
| `N` | 数値 |
| `BOOL` | 真偽値 |
| `L` | リスト |
| `M` | マップ |

---

## 9. Nucleus → DynamoDB フィールドマッピング早見表

### item テーブル

| Nucleus (item) | DynamoDB (newcleus-items) | 備考 |
|----------------|--------------------------|------|
| `inumber` | `itemId` (SK) | — |
| `ititle` | (未使用) | 旧システムではititleは空だった |
| `ibody` | `body` | HTML本文 |
| `imore` | `title` | 旧システムではimoreにタイトルを格納 |
| `iblog` | `siteId` (PK) | テーブルPKで自然に分離 |
| `iauthor` | `authorId` | Cognito sub |
| `itime` | `createdAt` | ISO 8601文字列 |
| `idraft` | `status` | 0→"published", 1→"draft" |
| `icat` | `contentTypeId` | コンテンツタイプID |
| `iclosed` | (廃止) | コメント機能なし |
| `ikarmapos/neg` | (廃止) | karma機能なし |

### plugin_myshowblogs テーブル

| Nucleus | DynamoDB (fields マップ) | 備考 |
|---------|--------------------------|------|
| `text0`〜`text9` | `fields.text0`〜`fields.text9` | S |
| `file0`〜`file9` | `fields.file0`〜`fields.file9` | S3 / CloudFront URL (S) |
| `flag0`〜`flag9` | `fields.flag0`〜`fields.flag9` | BOOL (0/1 → true/false) |
| `date0`〜`date9` | `fields.date0`〜`fields.date9` | ISO 8601 (S) |
| `num0`〜`num9` | `fields.num0`〜`fields.num9` | N |
| `textindex` | (廃止) | フリーワード検索なし |
