# newcleus — データベース設計書 v0.0.1

Firestore データベース設計。Nucleus CMS の設計思想 (blog/item/category/member/team/MyShowBlogs汎用フィールド) を Firestore ネイティブに翻訳したもの。

---

## コレクション一覧

| コレクション | 用途 | Nucleus対応 |
|-------------|------|-------------|
| `sites` | サイト（テナント）管理 | `cmsnucleus_blog` |
| `sites/{siteId}/categories` | カテゴリ | `cmsnucleus_category` |
| `sites/{siteId}/items` | 記事 | `cmsnucleus_item` + `cmsnucleus_plugin_myshowblogs` |
| `sites/{siteId}/fieldLabels` | 汎用フィールドのラベル定義 | `cmsnucleus_plugin_option_desc` (一部) |
| `users` | ユーザー | `cmsnucleus_member` + `cmsnucleus_team` |

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
| `ownerUid` | `string` | ○ | サイトオーナーのFirebase Auth uid | — |
| `ownerEmail` | `string` | ○ | オーナーのGmailアドレス | — |
| `allowedOrigins` | `array of string` | ○ | CORS許可オリジン (例: `["https://sample-clinic.com"]`) | — |
| `createdAt` | `timestamp` | ○ | 作成日時 | — |
| `updatedAt` | `timestamp` | ○ | 更新日時 | — |

### インデックス

| フィールド | 方向 | 用途 |
|-----------|------|------|
| `shortname` | ASC | shortname によるサイト検索 (ユニーク制約はアプリ層で担保) |
| `ownerUid` | ASC | オーナー別サイト一覧 |

---

## 2. categories サブコレクション

サイト内のカテゴリ定義。Nucleusの `category` テーブルに相当。

- **コレクションパス:** `/sites/{siteId}/categories`
- **ドキュメントID:** 自動生成ID

### フィールド

| フィールド名 | データ型 | 必須 | 説明 | Nucleus対応 |
|-------------|----------|------|------|-------------|
| `name` | `string` | ○ | カテゴリ名 (例: "お知らせ", "求人情報") | `cname` |
| `shortname` | `string` | ○ | API用識別名 (英数字ハイフン, 例: "news") | `cname` (英名) |
| `sortOrder` | `number` | ○ | 表示順 (小さい順) | — |
| `createdAt` | `timestamp` | ○ | 作成日時 | — |

---

## 3. items サブコレクション

記事データ。Nucleusの `item` テーブル + `plugin_myshowblogs` テーブルを統合。

- **コレクションパス:** `/sites/{siteId}/items`
- **ドキュメントID:** 自動生成ID

### フィールド

| フィールド名 | データ型 | 必須 | 説明 | Nucleus対応 |
|-------------|----------|------|------|-------------|
| `title` | `string` | ○ | 記事タイトル | `imore` (※旧システムではimoreにタイトルを格納していた) |
| `body` | `string` | ○ | 記事本文 (HTML, TinyMCE出力) | `ibody` |
| `categoryId` | `string` | ○ | カテゴリのドキュメントID | `icat` |
| `status` | `string` | ○ | `"published"` or `"draft"` | `idraft` (0/1の反転) |
| `authorUid` | `string` | ○ | 作成者のFirebase Auth uid | `iauthor` |
| `fields` | `map` | — | 汎用フィールド (後述) | `plugin_myshowblogs` テーブル |
| `createdAt` | `timestamp` | ○ | 作成日時 | `itime` |
| `updatedAt` | `timestamp` | ○ | 更新日時 | — |

### fields マップ (汎用フィールド)

Nucleusの `cmsnucleus_plugin_myshowblogs` テーブルが持っていた汎用フィールドをFirestoreのマップで表現。
カテゴリの `fieldLabels` で定義されたフィールドのみ使用する。

| キー | データ型 | 説明 | Nucleus対応 |
|------|----------|------|-------------|
| `text0` 〜 `text9` | `string` | テキストフィールド | `text0` 〜 `text9` |
| `file0` 〜 `file9` | `string` | ファイルURL (Firebase Storage) | `file0` 〜 `file9` |
| `flag0` 〜 `flag9` | `boolean` | フラグ | `flag0` 〜 `flag9` (0/1) |
| `date0` 〜 `date9` | `timestamp` | 日付 | `date0` 〜 `date9` |
| `num0` 〜 `num9` | `number` | 数値 | `num0` 〜 `num9` |

**例: 求人情報カテゴリの記事**
```json
{
  "title": "受付医療事務 募集中",
  "body": "<p>仲間達とそれぞれの夢に向かって...</p>",
  "categoryId": "xxx",
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
| `status` ASC + `categoryId` ASC + `createdAt` DESC | 複合 | カテゴリ別公開記事一覧 |
| `status` ASC + `fields.flag0` ASC + `createdAt` DESC | 複合 | フラグフィルタ付き記事一覧 |

---

## 4. fieldLabels サブコレクション

カテゴリ別の汎用フィールドラベル定義。管理画面のフォーム自動生成に使用。

- **コレクションパス:** `/sites/{siteId}/fieldLabels`
- **ドキュメントID:** カテゴリのドキュメントIDと同一

### フィールド

| フィールド名 | データ型 | 必須 | 説明 |
|-------------|----------|------|------|
| `text0_label` 〜 `text9_label` | `string` | — | textフィールドのラベル (例: "概要") |
| `file0_label` 〜 `file9_label` | `string` | — | fileフィールドのラベル (例: "メイン画像") |
| `flag0_label` 〜 `flag9_label` | `string` | — | flagフィールドのラベル (例: "公開フラグ") |
| `date0_label` 〜 `date9_label` | `string` | — | dateフィールドのラベル (例: "掲載開始日") |
| `num0_label` 〜 `num9_label` | `string` | — | numフィールドのラベル (例: "表示順") |

**ルール:** ラベルが定義されているフィールドのみ管理画面の入力フォームに表示する。未定義のフィールドは非表示。

**例: 求人情報カテゴリの fieldLabels**
```json
{
  "text0_label": "募集概要",
  "text1_label": "給与・待遇",
  "text3_label": "勤務時間",
  "text4_label": "休日",
  "text5_label": "福利厚生",
  "text6_label": "応募方法",
  "file0_label": "募集画像",
  "flag0_label": "トップ表示"
}
```

---

## 5. users コレクション

ユーザー管理。Nucleusの `member` + `team` テーブルを統合。

- **コレクションパス:** `/users`
- **ドキュメントID:** Firebase Auth の `uid`

### フィールド

| フィールド名 | データ型 | 必須 | 説明 | Nucleus対応 |
|-------------|----------|------|------|-------------|
| `uid` | `string` | ○ | Firebase Auth uid | `mnumber` |
| `email` | `string` | ○ | Gmailアドレス | `memail` |
| `displayName` | `string` | — | 表示名 | `mrealname` |
| `photoURL` | `string` | — | Googleプロフィール画像URL | — |
| `role` | `string` | ○ | `"superadmin"` / `"owner"` / `"editor"` | `madmin` + team |
| `siteIds` | `array of string` | ○ | 担当サイトのドキュメントID配列 | `cmsnucleus_team` |
| `createdAt` | `timestamp` | ○ | アカウント作成日時 | — |
| `updatedAt` | `timestamp` | ○ | 最終更新日時 | — |

### ロール定義

| ロール | 権限 | Nucleus対応 |
|--------|------|-------------|
| `superadmin` | 全サイト管理、サイト作成/削除、owner招待 | `madmin=1` |
| `owner` | 自サイトのカテゴリ・記事・fieldLabels管理、editor招待 | `tadmin=1` (team内) |
| `editor` | 自サイトの記事作成・編集のみ | `tadmin=0` (team内) |

### Firebase Auth Custom Claims

```json
{
  "role": "owner",
  "siteIds": ["siteId1", "siteId2"]
}
```

Firestoreの `users` ドキュメントと Custom Claims の両方に `role` / `siteIds` を持つ。
Custom Claims はセッション検証時の高速判定用、Firestoreは管理画面での表示・編集用。

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
    && request.auth.token.siteIds.hasAny([siteId]); // 当該サイトの担当者のみ書込み
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
| `icat` | `categoryId` | カテゴリID |
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
| `cmsnucleus_plugin_option` | fieldLabels で代替 |
| `cmsnucleus_plugin_option_desc` | fieldLabels で代替 |
| `cmsnucleus_skin` | 不要 (テンプレート機構廃止) |
| `cmsnucleus_skin_desc` | 不要 |
| `cmsnucleus_template` | 不要 |
| `cmsnucleus_template_desc` | 不要 |
| `cmsnucleus_tickets` | 不要 (Firebase Auth Session) |
