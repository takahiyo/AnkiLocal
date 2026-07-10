/**
 * Anki互換ノートタイプ・カード生成ロジック技術仕様書
 *
 * 本ドキュメントは、暗記カードアプリ「Anki」のコアメカニズムを
 * 本プロジェクト（AnkiLocal）で再現・流用するための開発用技術仕様書である。
 * AIコーダーやエンジニアがそのままシステム設計、データベース設計、
 * ロジック実装に利用できる構成としている。
 *
 * バージョン: 2.0.0
 * 最終更新: 2026-07-10
 * 参照実装: worker/api/notes.ts
 */

---

## 1. コア概念：ノート（Note）とカード（Card）の分離

Ankiの最も重要な設計思想は、「ノート（データの実態）」と「カード（学習する画面）」の分離である。

- **ノート（Note）**: ユーザーが入力したデータの集まり（フィールド値）
- **ノートタイプ（Note Type）**: ノートの「データ構造（フィールド定義）」と「表示用テンプレート（HTML/CSS）」を定義したマスターデータ
- **テンプレート（Card Template）**: フィールド値をどう画面に配置し、どのカードを生成するかを定義する設計図
- **カード（Card）**: テンプレートに基づいて自動生成される学習の最小単位。SRS（スペースド・レペティション）の管理対象

> **重要ロジック**: 1つの「ノート」から、ノートタイプの設定に従って1つまたは複数の「カード」が自動生成される

---

## 2. 共通データモデル（データベース設計の推奨スキーマ）

### 2.1 カードテーブル（既存: schema.sql `cards`）

```sql
CREATE TABLE IF NOT EXISTS cards (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    guid        TEXT    NOT NULL,           -- ノートのGUID（一意識別子）
    deck_id     INTEGER NOT NULL,           -- 所属デッキID
    note_type   TEXT    NOT NULL,           -- ノートタイプ名
    front       TEXT    NOT NULL,           -- 表面（レンダリング済みテキスト）
    back        TEXT    NOT NULL DEFAULT '',-- 裏面（レンダリング済みテキスト）
    tags        TEXT    NOT NULL DEFAULT '',-- タグ
    cloze_count INTEGER NOT NULL DEFAULT 0, -- Clozeの最大インデックス数
    cloze_index INTEGER NOT NULL DEFAULT 0, -- このカードのClozeインデックス
    is_reversed INTEGER NOT NULL DEFAULT 0, -- 反転カードフラグ
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE,
    UNIQUE(guid, cloze_index, is_reversed)
);
```

### 2.2 データフロー（インポート時）

```
Ankiテキストファイル
    ↓ parser.ts (parseAnkiFile)
生フィールド値の配列 [guid, noteType, deckName, front, back, tags, field6...]
    ↓ notes.ts (generateCards) ※ ノートタイプ別に分岐・展開
RenderedCard[] (front/back レンダリング済みカード配列)
    ↓ worker/index.ts (POST /api/import)
cards テーブルに INSERT
```

---

## 3. 各ノートタイプの挙動・仕様詳細

### 3.1 Basic（基本）

最もシンプルな1対1のカード。

| 項目 | 内容 |
|------|------|
| 想定フィールド | `Front`（表面）, `Back`（裏面） |
| 生成カード数 | 常に 1枚 |
| 生成条件 | `Front` フィールドが空でない場合 |

**カード表示**:
- 表面: `{{Front}}`
- 裏面: `{{Front}}\n<hr id="answer">\n{{Back}}`

**本プロジェクト実装**: `generateBasicCards()` in `worker/api/notes.ts`

---

### 3.2 Basic (and reversed card)（基本・両方向）

入力したデータから、順方向と逆方向の2枚のカードを自動で作成する。

| 項目 | 内容 |
|------|------|
| 想定フィールド | `Front`（表面）, `Back`（裏面） |
| 生成カード数 | 最大 2枚 |

**生成条件**:
- Card 1（順方向）: `Front` フィールドが空でない場合に生成
- Card 2（逆方向）: `Back` フィールドが空でない場合に生成

**カード表示**:
- Card 1: 表面=`{{Front}}`, 裏面=`{{Front}}\n<hr id="answer">\n{{Back}}`
- Card 2: 表面=`{{Back}}`, 裏面=`{{Back}}\n<hr id="answer">\n{{Front}}`

> **Note**: 逆方向カードは生成時に front/back が入れ替わった状態で DB に保存される。
> フロントエンドでは `is_reversed` フラグを参照可能だが、単純に front/back をそのまま表示すればよい。

**本プロジェクト実装**: `generateBasicReversedCards()` in `worker/api/notes.ts`

---

### 3.3 Basic (optional reversed card)（基本・逆方向カード選択可）

特定のトリガー用フィールドに文字が入力されている場合のみ、逆方向カードを追加で生成する。

| 項目 | 内容 |
|------|------|
| 想定フィールド | `Front`（表面）, `Back`（裏面）, `Add Reverse`（トリガー） |
| 生成カード数 | 1枚 または 2枚 |

**生成条件**:
- Card 1（順方向）: `Front` フィールドが空でない場合に生成
- Card 2（逆方向）: `Back` フィールドが空でない **かつ** `Add Reverse` フィールドに1文字以上の文字が入力されている場合に生成

**Ankiテキストファイル上でのデータ配置**:
```
フィールド1  フィールド2  フィールド3  フィールド4  フィールド5  フィールド6  フィールド7
guid        note_type   deck_name    Front        Back         Add Reverse  tags
```

> **重要**: 現行実装では `Add Reverse` フィールドはフィールド6（0-based index 5）に位置する。
> このフィールドが空でなければ逆方向カードを生成する。

**本プロジェクト実装**: `generateBasicOptionalReversedCards()` in `worker/api/notes.ts`

---

### 3.4 Basic (type in the answer)（基本・解答入力）

ユーザーがキーボードで解答を入力し、システムが正誤判定（文字列差分チェック/差分ハイライト）を行う。

| 項目 | 内容 |
|------|------|
| 想定フィールド | `Front`（表面）, `Back`（正しい答え） |
| 生成カード数 | 常に 1枚 |

**UI動作要件**:
1. 表面表示時: テキスト入力フォーム（`<input type="text">`）を表示し、フォーカスを当てる
2. Enterキー押下時: 裏面（解答）画面へ遷移
3. 裏面表示時: 入力された文字列（User Input）と `Back` の文字列（Correct Answer）を比較し、差分を視覚的に表示する

**差分ハイライトの仕様**:
- 一致部分: 緑色背景 / 緑色文字
- 誤り（スペルミス・余分な文字）: 赤色背景 / 取り消し線
- 不足部分（打ち忘れた文字）: 黄色または青色背景（下線）

**テンプレートプレースホルダー**:
- 表面: `{{Front}}\n{{type:Back}}`
- 裏面: `{{Front}}\n<hr id="answer">\n{{type:Back}}\n{{Back}}`

> **Note**: カード生成ロジックはBasicと同一。`{{type:Back}}` の解釈・入力フォーム表示・
> 差分ハイライトはすべてフロントエンド側で実装する。

**本プロジェクト実装**: `generateBasicTypeInAnswerCards()` in `worker/api/notes.ts`（カード構造はBasicと同一）

---

### 3.5 Cloze（穴埋め）

1つの文章の特定部分を虫食い状態にし、その部分を答えるカード。
1つのノートから、指定された穴埋め（インデックス）数だけ別々のカードが生成される。

| 項目 | 内容 |
|------|------|
| 想定フィールド | `Text`（穴埋め記法を含む本文）, `Back Extra`（裏面追加テキスト） |
| 生成カード数 | Text内の一意なClozeインデックス数 |

**穴埋め記法**: `{{c[インデックス]::[答え]::[ヒント（任意）]}}`

例:
```
Ankiは{{c1::忘却曲線}}に基づいた{{c2::フラッシュカード::何アプリ？}}アプリです。
```
→ c1 と c2 の2インデックス → **2枚のカード**を生成

**カード表示例（c1用）**:
- 表面: `Ankiは[...]に基づいたフラッシュカードアプリです。`
- 裏面: `Ankiは<strong>忘却曲線</strong>に基づいたフラッシュカードアプリです。`

**カード表示例（c2用）**:
- 表面: `Ankiは忘却曲線に基づいた[何アプリ？]アプリです。`
- 裏面: `Ankiは忘却曲線に基づいた<strong>フラッシュカード</strong>アプリです。`

**Clozeパース用正規表現**:
```typescript
const CLOZE_PATTERN = /\{\{c(\d+)::([^:}]+)(?:::(.*?[^\\]))?\}\}/g;
// マッチグループ: (1)番号, (2)答え, (3)ヒント（オプション）
```

**本プロジェクト実装**:
- サーバーサイド: `generateClozeCards()` in `worker/api/notes.ts`
- クライアントサイド: `renderClozeQuestion()` / `renderClozeAnswer()` in `frontend/js/services/cloze.js`

---

### 3.6 Image Occlusion（画像目隠し）

画像上の特定部分（矩形など）をマスクで隠し、その場所を答える視覚的なカード。

| 項目 | 内容 |
|------|------|
| 想定フィールド | `Image`（ベース画像URLまたはBase64）, `Header`（上部テキスト）, `Footer`（下部テキスト）, `OcclusionData`（マスク座標JSON） |
| 生成カード数 | `OcclusionData` 内の `is_card: true` なマスクの数 |

**マスクデータのデータ構造（推奨JSON）**:
```json
[
  {
    "id": "mask_0",
    "type": "rect",
    "x": 120, "y": 80, "width": 100, "height": 40,
    "is_card": true
  },
  {
    "id": "mask_1",
    "type": "rect",
    "x": 340, "y": 150, "width": 80, "height": 40,
    "is_card": true
  }
]
```

**カード表示制御**:
- `is_card: true` のマスクごとに1枚のカードを生成
- Card N（mask_N のクイズ）の**表面**:
  - mask_N（当問の標的）: 赤色マスクで隠す
  - 他マスク: 黄色マスクで隠したままにする
- Card N（mask_N のクイズ）の**裏面**:
  - mask_N: マスクを非表示（半透明枠のみ）にし、隠れていた部分を露出
  - 他マスク: 黄色マスクのまま隠し続ける（連鎖的なネタバレ防止）

**フロントエンド実装のポイント**:
- SVGレイヤー重ね合わせ: `<div>` 内にベース画像を配置し、その上に等倍の SVG を重ねてマスク図形（`<rect>`, `<ellipse>`）を描画
- レスポンシブ対応: SVGの `viewBox` に画像のオリジナル幅・高さを指定し、CSSは `width: 100%; height: auto;`

**本プロジェクト実装**: `generateImageOcclusionCards()` in `worker/api/notes.ts`

---

## 4. カード自動生成ロジックの疑似コード

```typescript
function generateCards(noteType: string, fields: FieldMap): RenderedCard[] {
  switch (noteType) {
    case "Basic":
      if (fields["Front"]?.trim()) → [{ front, back, ... }]

    case "Basic (and reversed card)":
      if (fields["Front"]?.trim()) → Card 1
      if (fields["Back"]?.trim())  → Card 2 (reversed)

    case "Basic (optional reversed card)":
      if (fields["Front"]?.trim()) → Card 1
      if (fields["Add Reverse"]?.trim() && fields["Back"]?.trim()) → Card 2 (reversed)

    case "Basic (type in the answer)":
      → Basic と同一構造（UI差分はフロントエンド）

    case "Cloze":
      clozeNumbers = Text から抽出した一意なインデックス集合
      for each index → { front: renderClozeFront(text, index), ... }

    case "Image Occlusion":
      masks = JSON.parse(fields["OcclusionData"])
      masks.filter(m => m.is_card).forEach(mask → { front, back, ... })
  }
}
```

---

## 5. UI/UX実装上の注意点

1. **フォントと数式**: AnkiはLaTeX/KaTeXに対応。本プロジェクトでも `$...$` や `$$...$$` による数式表示をサポートすると汎用性が向上する
2. **HTML/CSSパース**: フィールド内にはプレーンテキストだけでなく、ボールド（`<b>`）、カラー、画像埋め込み（`<img>`）などのHTMLタグが含まれる。フロントエンドで描画する際は、XSS対策を施した上でHTMLとしてレンダリングする必要がある
3. **メディア参照**: Ankiはローカルメディアファイル（画像、音声）をコレクション内で管理する。本プロジェクトでは現在未対応だが、将来的に画像/音声フィールドのサポートが必要になる可能性がある
4. **CSS注入**: ノートタイプごとにカスタムCSSが定義される。本プロジェクトの現在のアーキテクチャでは、ノートタイプ別CSSは未実装（今後の拡張余地）

---

## 6. 変更履歴

| 日付 | バージョン | 変更内容 |
|------|-----------|---------|
| 2026-07-10 | 2.0.0 | 初版作成。全6ノートタイプの仕様を体系化。`worker/api/notes.ts` に参照実装を提供 |