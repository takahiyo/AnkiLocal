# デバッグおよび追加開発の記録

## 課題
1. **解答後、「デッキに戻る」ボタンが利かない**
   - 原因：`index.html` 内の「デッキ一覧に戻る」ボタンにIDが付いておらず、`study.js` でクリックイベントがバインドされていなかった。
2. **最大出題数やランダム等のオプション画面が無い**
   - 原因：デッキごとのオプション設定UIおよびバックエンドAPI/DBテーブルが未実装。

---

## 調査と対応工程

### 1. 「デッキに戻る」ボタンの不具合調査
- 対象ファイル：`frontend/index.html`, `frontend/js/modules/study.js`
- 対策：ボタンにID `study-complete-back-btn` を付与し、`study.js` の `bindEvents()` 内でクリック時に `navigateTo('/decks')` を呼ぶように修正する。

### 2. オプション画面・機能の設計
- 対応：
  - `deck_options` テーブルの作成。
  - API エンドポイント `/decks/:deckId/options` (GET/POST) の新規作成。
  - 学習カード取得時のオプション反映（上限数、並び順順次/ランダム）。
  - 各デッキの右上に設定ボタン（⚙️）を追加し、 vanilla JS による設定モーダルを実装。

### 3. 実装計画の更新
- 対応：`implementation_plan.md` を更新し、ユーザーの承認待ち。
