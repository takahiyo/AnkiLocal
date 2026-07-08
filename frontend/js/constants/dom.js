/**
 * constants/dom.js - DOM ID / セレクタ定義（SSOT）
 *
 * HTML内のすべてのIDおよび主要セレクタを一元管理する。
 * JavaScript側からDOMを参照する際は必ずこの定数を使用し、
 * 文字列リテラルでのID直書きを禁止する。
 *
 * 依存: なし
 * 参照元: modules/*.js, main.js
 */

/** ページセクションのID */
export const PAGE_IDS = Object.freeze({
  LOGIN: 'page-login',
  REGISTER: 'page-register',
  DECK_LIST: 'page-deck-list',
  STUDY: 'page-study',
  STATS: 'page-stats',
  IMPORT: 'page-import',
  ADMIN: 'page-admin',
});

/** ナビゲーションのID */
export const NAV_IDS = Object.freeze({
  LINK_DECKS: 'nav-decks',
  LINK_STATS: 'nav-stats',
  LINK_IMPORT: 'nav-import',
  LINK_ADMIN: 'nav-admin',
  LINK_LOGOUT: 'nav-logout',
});

/** 認証画面 */
export const AUTH_IDS = Object.freeze({
  LOGIN_USERNAME: 'login-username',
  LOGIN_PASSWORD: 'login-password',
  LOGIN_SUBMIT: 'login-submit-btn',
  LOGIN_ERROR: 'login-error',

  REGISTER_USERNAME_DISPLAY: 'register-username-display',
  REGISTER_PASSWORD: 'register-password',
  REGISTER_PASSWORD_CONFIRM: 'register-password-confirm',
  REGISTER_SUBMIT: 'register-submit-btn',
  REGISTER_ERROR: 'register-error',
  REGISTER_BACK: 'register-back-btn',
});

/** デッキ一覧画面 */
export const DECK_LIST_IDS = Object.freeze({
  CONTAINER: 'deck-list-container',
  GRID: 'deck-list-grid',
  LOADING: 'deck-list-loading',
});

/** 学習画面 */
export const STUDY_IDS = Object.freeze({
  DECK_NAME: 'study-deck-name',
  PROGRESS_TEXT: 'study-progress-text',
  PROGRESS_BAR: 'study-progress-bar',
  CARD_CONTAINER: 'study-card-container',
  CARD_FRONT_TEXT: 'study-card-front-text',
  CARD_BACK_TEXT: 'study-card-back-text',
  CARD_META: 'study-card-meta',
  SHOW_ANSWER_BTN: 'study-show-answer',
  RATING_BUTTONS: 'study-rating-buttons',
  BTN_AGAIN: 'study-btn-again',
  BTN_HARD: 'study-btn-hard',
  BTN_GOOD: 'study-btn-good',
  BTN_EASY: 'study-btn-easy',
  COMPLETE_SECTION: 'study-complete',
  CARD_SECTION: 'study-card-section',
  BACK_BTN: 'study-back-btn',
});

/** 統計画面 */
export const STATS_IDS = Object.freeze({
  SUMMARY_GRID: 'stats-summary-grid',
  TOTAL_CARDS: 'stats-total-cards',
  NEW_COUNT: 'stats-new-count',
  LEARNING_COUNT: 'stats-learning-count',
  REVIEW_COUNT: 'stats-review-count',
  MASTERED_COUNT: 'stats-mastered-count',
  CHART_CONTAINER: 'stats-chart-container',
  DECK_TABLE: 'stats-deck-table',
  LOADING: 'stats-loading',
});

/** インポート画面 */
export const IMPORT_IDS = Object.freeze({
  DROP_ZONE: 'import-drop-zone',
  FILE_INPUT: 'import-file-input',
  FILE_BTN: 'import-file-btn',
  LOADING: 'import-loading',
  RESULT: 'import-result',
  RESULT_CONTENT: 'import-result-content',
});

/** トースト通知 */
export const TOAST_IDS = Object.freeze({
  CONTAINER: 'toast-container',
});

/** フッター */
export const FOOTER_IDS = Object.freeze({
  VERSION: 'app-version',
});