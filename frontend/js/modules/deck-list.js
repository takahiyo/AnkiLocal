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
import { fetchDecks, fetchDeckOptions, updateDeckOptions } from '../services/api.js';
import { navigateTo } from './router.js';

let currentOptionsDeckId = null;

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
  const studyReady = newCount + learningCount + reviewCount;
  const masteredCount = Math.max(0, total - studyReady);
  const progressPercent = total > 0 ? Math.round((masteredCount / total) * 100) : 0;

  return `
    <div class="card deck-card" data-deck-id="${deck.id}" role="button" tabindex="0"
         aria-label="${escapeHtml(deck.name)} - ${total}枚のカード">
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
          <button class="btn btn-icon deck-options-btn" data-deck-id="${deck.id}" style="margin-left: 8px; font-size: 1.2rem; cursor: pointer; border: none; background: transparent; vertical-align: middle;" aria-label="設定" title="設定">⚙️</button>
        </div>
      </div>
      <div class="deck-card-badges">
        <span class="badge badge-new">新規 ${newCount}</span>
        <span class="badge badge-learning">学習中 ${learningCount}</span>
        <span class="badge badge-review">復習 ${reviewCount}</span>
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
  const container = document.getElementById(DECK_LIST_IDS.CONTAINER);

  if (!grid) return;

  // ローディング表示
  if (loading) loading.style.display = 'flex';
  if (container) container.style.display = 'none';
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
    if (loading) loading.style.display = 'none';
    if (container) container.style.display = 'block';
  }
}

/**
 * デッキカードのクリックハンドラ（イベント委譲）。
 * カード全体またはボタンクリックで学習画面に遷移する。
 * @param {MouseEvent} e
 */
function handleDeckClick(e) {
  // オプションボタンのクリック
  const optionsBtn = e.target.closest('.deck-options-btn');
  if (optionsBtn) {
    e.stopPropagation(); // 学習開始への遷移を防ぐ
    openOptionsModal(optionsBtn.dataset.deckId);
    return;
  }

  // 学習開始ボタン、またはカード全体のクリックを処理
  const btn = e.target.closest('.study-start-btn');
  const card = e.target.closest('.deck-card');

  const deckId = btn?.dataset?.deckId || card?.dataset?.deckId;
  if (deckId) {
    navigateTo(`/study/${deckId}`);
  }
}

/**
 * オプションモーダルを開く
 */
async function openOptionsModal(deckId) {
  if (!deckId) {
    showToast('デッキIDが指定されていません', 'error');
    return;
  }

  currentOptionsDeckId = deckId;
  const modal = document.getElementById('deck-options-modal');
  if (!modal) {
    showToast('設定モーダルが見つかりません', 'error');
    return;
  }

  const newCardsInput = document.getElementById('option-new-cards');
  const reviewCardsInput = document.getElementById('option-review-cards');
  const reviewOrderSelect = document.getElementById('option-review-order');

  if (!newCardsInput || !reviewCardsInput || !reviewOrderSelect) {
    showToast('モーダル要素が見つかりません', 'error');
    return;
  }

  try {
    const options = await fetchDeckOptions(deckId);
    newCardsInput.value = options.max_new_cards;
    reviewCardsInput.value = options.max_review_cards;
    reviewOrderSelect.value = options.review_order;

    modal.classList.remove('hidden');
    modal.classList.add('active');
  } catch (err) {
    showToast(`オプションの取得に失敗しました: ${err.message}`, 'error');
  }
}
}

/**
 * オプションモーダルを閉じる
 */
function closeOptionsModal() {
  const modal = document.getElementById('deck-options-modal');
  if (modal) {
    modal.classList.remove('active');
    setTimeout(() => modal.classList.add('hidden'), 300);
  }
  currentOptionsDeckId = null;
}

/**
 * オプションを保存する
 */
async function saveOptions() {
  if (!currentOptionsDeckId) return;
  
  const maxNew = parseInt(document.getElementById('option-new-cards').value, 10);
  const maxRev = parseInt(document.getElementById('option-review-cards').value, 10);
  const order = document.getElementById('option-review-order').value;
  
  try {
    await updateDeckOptions(currentOptionsDeckId, {
      max_new_cards: isNaN(maxNew) ? 20 : maxNew,
      max_review_cards: isNaN(maxRev) ? 100 : maxRev,
      review_order: order
    });
    showToast('オプションを保存しました', 'success');
    closeOptionsModal();
  } catch (err) {
    showToast(`オプションの保存に失敗しました: ${err.message}`, 'error');
  }
}

/**
 * デッキ一覧モジュールを初期化する。
 */
export function init() {
  // モーダルイベントのバインド
  const closeBtn = document.getElementById('deck-options-close');
  const saveBtn = document.getElementById('deck-options-save');
  const modalOverlay = document.getElementById('deck-options-modal');
  
  if (closeBtn) closeBtn.addEventListener('click', closeOptionsModal);
  if (saveBtn) saveBtn.addEventListener('click', saveOptions);
  
  // 背景クリックで閉じる
  if (modalOverlay) {
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) closeOptionsModal();
    });
  }
}
