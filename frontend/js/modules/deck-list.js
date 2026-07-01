/**
 * modules/deck-list.js - デッキ選択画面
 *
 * APIからデッキ一覧を取得し、カード形式で一覧表示する。
 * 各デッキにはカード数、new/learning/review バッジ、プログレスバーを表示。
 * クリックで学習画面へ遷移する。
 *
 * 依存: constants/dom.js, services/api.js, modules/router.js
 * 参照元: main.js から init() で起動
 */

import { DECK_LIST_IDS } from '../constants/index.js';
import { fetchDecks } from '../services/api.js';
import { navigateTo } from './router.js';

/**
 * トースト通知を表示するユーティリティ。
 * main.jsで定義されるグローバル関数を利用する。
 * @param {string} message - 表示メッセージ
 * @param {string} type - 'success' | 'error' | 'warning' | 'info'
 */
function showToast(message, type = 'error') {
  if (typeof window._showToast === 'function') {
    window._showToast(message, type);
  } else {
    console.error(message);
  }
}

/**
 * デッキカードのHTML文字列を生成する。
 * @param {object} deck - デッキ情報 {id, name, card_count, new_count, review_count, learning_count}
 * @returns {string} HTML文字列
 */
function renderDeckCard(deck) {
  const total = deck.card_count || 0;
  const newCount = deck.new_count || 0;
  const learningCount = deck.learning_count || 0;
  const reviewCount = deck.review_count || 0;
  // 学習可能なカードの合計
  const studyReady = newCount + learningCount + reviewCount;
  // 習得済み（概算: 全体 - new - learning - review）
  const masteredCount = Math.max(0, total - studyReady);
  const progressPercent = total > 0 ? Math.round((masteredCount / total) * 100) : 0;

  return `
    <div class="card deck-card" data-deck-id="${deck.id}" role="button" tabindex="0"
         aria-label="${deck.name} - ${total}枚のカード">
      <div class="deck-card-header">
        <div>
          <div class="deck-card-name">${escapeHtml(deck.name)}</div>
          <div class="deck-card-count">${total}枚のカード</div>
        </div>
        <div>
          ${studyReady > 0
            ? `<span class="badge badge-review" style="font-size: 0.9rem; padding: 4px 12px;">${studyReady}</span>`
            : `<span class="badge" style="background: rgba(16,185,129,0.15); color: var(--color-success); border: 1px solid rgba(16,185,129,0.3);">✓</span>`
          }
        </div>
      </div>
      <div class="deck-card-badges">
        ${newCount > 0 ? `<span class="badge badge-new">新規 ${newCount}</span>` : ''}
        ${learningCount > 0 ? `<span class="badge badge-learning">学習中 ${learningCount}</span>` : ''}
        ${reviewCount > 0 ? `<span class="badge badge-review">復習 ${reviewCount}</span>` : ''}
      </div>
      <div class="progress-bar">
        <div class="progress-bar-fill" style="width: ${progressPercent}%"></div>
      </div>
      <div class="deck-card-footer">
        <span style="font-size: var(--font-size-xs); color: var(--text-muted);">
          習得率 ${progressPercent}%
        </span>
        <button class="btn btn-primary btn-sm study-start-btn" data-deck-id="${deck.id}">
          学習開始 →
        </button>
      </div>
    </div>
  `;
}

/**
 * HTMLエスケープ（XSS防止）
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * デッキ一覧を読み込んで描画する。
 */
export async function loadDeckList() {
  const grid = document.getElementById(DECK_LIST_IDS.GRID);
  const loading = document.getElementById(DECK_LIST_IDS.LOADING);

  if (!grid) return;

  // ローディング表示
  if (loading) loading.classList.remove('hidden');
  grid.innerHTML = '';

  try {
    const decks = await fetchDecks();

    if (!decks || decks.length === 0) {
      grid.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📚</div>
          <h3 class="empty-state-title">デッキがありません</h3>
          <p class="empty-state-text">テキストファイルをインポートして学習を始めましょう</p>
          <button class="btn btn-primary btn-lg" onclick="window.location.hash='#/import'">
            📥 インポート
          </button>
        </div>
      `;
      return;
    }

    // デッキカードを生成して描画
    grid.innerHTML = decks.map(renderDeckCard).join('');
    grid.classList.add('stagger-in');

    // カードクリックイベント（イベント委譲）
    grid.addEventListener('click', handleDeckClick);

  } catch (err) {
    showToast(`デッキの取得に失敗しました: ${err.message}`, 'error');
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">⚠️</div>
        <h3 class="empty-state-title">読み込みエラー</h3>
        <p class="empty-state-text">${escapeHtml(err.message)}</p>
        <button class="btn btn-secondary" onclick="location.reload()">再読み込み</button>
      </div>
    `;
  } finally {
    if (loading) loading.classList.add('hidden');
  }
}

/**
 * デッキカードのクリックハンドラ（イベント委譲）。
 * カード全体またはボタンクリックで学習画面に遷移する。
 * @param {MouseEvent} e
 */
function handleDeckClick(e) {
  // 学習開始ボタン、またはカード全体のクリックを処理
  const btn = e.target.closest('.study-start-btn');
  const card = e.target.closest('.deck-card');

  const deckId = btn?.dataset?.deckId || card?.dataset?.deckId;
  if (deckId) {
    navigateTo(`/study/${deckId}`);
  }
}

/**
 * デッキ一覧モジュールを初期化する。
 */
export function init() {
  // 初回読み込みはルーター経由で行われるため、ここでは何もしない
  // loadDeckList() は onRouteChange コールバックから呼ばれる
}
