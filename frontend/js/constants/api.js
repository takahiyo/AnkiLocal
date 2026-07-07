/**
 * constants/api.js - APIエンドポイント定義（SSOT）
 *
 * バックエンドAPIのすべてのエンドポイントを一元管理する。
 * 他のファイルでURLを直接記述することを禁止する。
 *
 * 依存: なし
 * 参照元: services/api.js
 */

/** APIエンドポイント一覧 */
export const API = Object.freeze({
  /** GET: デッキ一覧取得 → [{id, name, card_count, new_count, review_count, learning_count}] */
  DECKS: '/api/decks',

  /** POST: テキストファイルインポート（FormData） → {imported_count, skipped_count, decks: [...]} */
  IMPORT: '/api/import',

  /** GET: 指定デッキの学習対象カード → [{id, note_type, front, back, cloze_index, is_reversed}] */
  STUDY: (deckId) => `/api/decks/${deckId}/study`,

  /** POST: カードレビュー送信 body:{rating:1-4} → {next_review_at, interval_days, ease_factor} */
  REVIEW: (cardId) => `/api/cards/${cardId}/review`,

  /** GET/POST: デッキオプション設定 */
  OPTIONS: (deckId) => `/api/decks/${deckId}/options`,

  /** GET: デッキ内タグ一覧 */
  TAGS: (deckId) => `/api/decks/${deckId}/tags`,

  /** GET: 全体統計 → {total_cards, new_count, learning_count, review_count, mastered_count, decks:[...], recent_reviews:[...]} */
  STATS: '/api/stats',

  /** GET: デッキ別統計 */
  DECK_STATS: (deckId) => `/api/stats/deck/${deckId}`,
});
