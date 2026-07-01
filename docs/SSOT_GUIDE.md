# SSOT（Single Source of Truth）実践ガイド

本ドキュメントは、コード内の定数・設定値・識別子を一元管理するための実践方法を定める。

## 1. SSOT化の対象
**必須対象（ハードコーディング厳禁）**:
- URL・エンドポイント
- DOM ID・セレクタ (`#viewer`, `.modal`)
- 特殊な設定値・閾値 (APIタイムアウト等)
- 状態を表す文字列 (`"loading"`, `"error"`)
- ストレージのキー名

## 2. 実装パターン
`constants/` フォルダ配下にカテゴリ別ファイルを作成し、`index.js`（バレル）でまとめる。

1. オブジェクト形式の定数は必ず `Object.freeze()` で保護し、実行時の予期せぬ変更を防ぐ。
2. 命名規則：定数は `UPPER_SNAKE_CASE` とする。

```javascript
export const DOM_IDS = Object.freeze({
  VIEWER: "viewer",
  MODAL: "modal"
});
```

## 3. バックエンド（Python）の場合
- 設定は `config.py` に集約
- 定数は `UPPER_SNAKE_CASE` で定義
- 環境変数は `os.environ.get()` で取得し、デフォルト値を必ず設定
