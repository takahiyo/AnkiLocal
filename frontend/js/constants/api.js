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
  /** POST: ログイン {username, password} → {success, token, is_admin, username} */
  LOGIN: '/api/auth/login',

  /** POST: 新規登録 {username, password} → {success, token, is_admin, username} */
  REGISTER: '/api/auth/register',

  /** POST: ログアウト */
  LOGOUT: '/api/auth/logout',

  /** GET: 現在のユーザー情報 */
  ME: '/api/auth/me',

  /** GET: デッキ一覧取得 */
  DECKS: '/api/decks',

  /** POST: テキストファイルインポート プレビュー（FormData） */
  IMPORT_PREVIEW: '/api/import/preview',

  /** POST: テキストファイルインポート実行（FormData + mode） */
  IMPORT: '/api/import',

  /** GET: 指定デッキの学習対象カード */
  STUDY: (deckId) => `/api/decks/${deckId}/study`,

  /** POST: カードレビュー送信 body:{rating:1-4} */
  REVIEW: (cardId) => `/api/cards/${cardId}/review`,

  /** GET/POST: デッキオプション設定 */
  OPTIONS: (deckId) => `/api/decks/${deckId}/options`,

  /** GET: デッキ内タグ一覧 */
  TAGS: (deckId) => `/api/decks/${deckId}/tags`,

  /** GET: 全体統計 */
  STATS: '/api/stats',

  /** GET: デッキ別統計 */
  DECK_STATS: (deckId) => `/api/stats/deck/${deckId}`,

  /** GET: 管理者用 ユーザー一覧 */
  ADMIN_USERS: '/api/admin/users',

  /** DELETE: 管理者用 ユーザー削除 */
  ADMIN_USER_DELETE: (userId) => `/api/admin/users/${userId}`,

  /** POST: 管理者用 パスワード変更 */
  ADMIN_USER_PASSWORD: (userId) => `/api/admin/users/${userId}/password`,

  /** POST: 管理者用 学習状態リセット */
  ADMIN_USER_RESET: (userId) => `/api/admin/users/${userId}/reset`,
});