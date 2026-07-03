/**
 * modules/study.js - 学習画面（メイン機能）
 *
 * カードフリップアニメーション付きのフラッシュカード学習機能。
 * ノートタイプ別レンダリング（Basic, Basic reversed, Cloze）に対応。
 * 評価ボタン（Again/Hard/Good/Easy）でSRSレビューを送信する。
 *
 * 依存: constants/index.js, services/api.js, services/cloze.js, modules/router.js
 * 参照元: main.js から init() で起動
 */

import { STUDY_IDS, NOTE_TYPES } from '../constants/index.js';
import { fetchStudyCards, submitReview, fetchDecks } from '../services/api.js';
import { renderClozeQuestion, renderClozeAnswer } from '../services/cloze.js';
import { navigateTo } from './router.js';

/* === モジュール内部状態 === */
let _cards = [];           // 学習対象カード配列
let _currentIndex = 0;     // 現在のカードインデックス
let _isFlipped = false;    // フリップ状態
let _isProcessing = false; // レビュー送信中フラグ（二重送信防止）
let _currentDeckId = null; // 現在のデッキID

/**
 * トースト通知（main.jsのグローバル関数経由）
 */
function showToast(message, type = 'error') {
  if (typeof window._showToast === 'function') {
    window._showToast(message, type);
  }
}

/**
 * DOM要素を安全に取得するヘルパー。
 * @param {string} id - 要素のID
 * @returns {HTMLElement|null}
 */
function $(id) {
  return document.getElementById(id);
}

/**
 * 指定デッキの学習セッションを開始する。
 * APIからカードを取得し、最初のカードを表示する。
 * @param {string} deckId - デッキID
 */
export async function startStudySession(deckId) {
  _currentDeckId = deckId;
  _currentIndex = 0;
  _isFlipped = false;
  _cards = [];

  // UIリセット
  const cardSection = $(STUDY_IDS.CARD_SECTION);
  const completeSection = $(STUDY_IDS.COMPLETE_SECTION);
  if (cardSection) cardSection.classList.remove('hidden');
  if (completeSection) completeSection.classList.add('hidden');

  try {
    _cards = await fetchStudyCards(deckId);

    // デッキ名を取得して表示
    try {
      const decks = await fetchDecks();
      const deck = decks.find(d => String(d.id) === String(deckId));
      if (deck) {
        const deckNameEl = $(STUDY_IDS.DECK_NAME);
        if (deckNameEl) deckNameEl.textContent = deck.name;
      }
    } catch (e) {
      console.warn("Could not fetch deck name", e);
    }

    if (!_cards || _cards.length === 0) {
      showComplete();
      return;
    }

    showCard();
  } catch (err) {
    showToast(`カードの取得に失敗しました: ${err.message}`, 'error');
  }
}

/**
 * 現在のカードを表示する（表面）。
 */
function showCard() {
  if (_currentIndex >= _cards.length) {
    showComplete();
    return;
  }

  const card = _cards[_currentIndex];
  _isFlipped = false;

  // カードコンテナのフリップ状態をリセットし、横回転アニメーションを付与
  const container = $(STUDY_IDS.CARD_CONTAINER);
  if (container) {
    if (container.classList.contains('flipped')) {
      container.classList.remove('flipped');
      // 次のカードアニメーション
      container.classList.remove('next-card-anim');
      // リフローを強制してアニメーションを再トリガー
      void container.offsetWidth;
      container.classList.add('next-card-anim');
      setTimeout(() => {
        container.classList.remove('next-card-anim');
      }, 400); // CSSの.4sに合わせる
    }
  }

  // ノートタイプに応じたテキスト生成
  const { frontHtml, backHtml, metaText } = renderCardContent(card);

  // DOM更新
  const frontText = $(STUDY_IDS.CARD_FRONT_TEXT);
  const backText = $(STUDY_IDS.CARD_BACK_TEXT);
  const meta = $(STUDY_IDS.CARD_META);

  if (frontText) frontText.innerHTML = frontHtml;
  if (backText) backText.innerHTML = backHtml;
  if (meta) meta.textContent = metaText;

  // ボタン表示制御: 答えを見るボタンを表示、評価ボタンを非表示
  const showAnswerBtn = $(STUDY_IDS.SHOW_ANSWER_BTN);
  const ratingButtons = $(STUDY_IDS.RATING_BUTTONS);
  if (showAnswerBtn) showAnswerBtn.classList.remove('hidden');
  if (ratingButtons) ratingButtons.classList.add('hidden');

  // 進捗更新
  updateProgress();
}

/**
 * ノートタイプに応じたカードコンテンツをレンダリングする。
 * @param {object} card - カードオブジェクト {note_type, front, back, cloze_index, is_reversed}
 * @returns {{ frontHtml: string, backHtml: string, metaText: string }}
 */
function renderCardContent(card) {
  const noteType = card.note_type || NOTE_TYPES.BASIC;

  // Clozeタイプ
  if (noteType === NOTE_TYPES.CLOZE) {
    const targetIndex = card.cloze_index || 1;
    return {
      frontHtml: renderClozeQuestion(card.front, targetIndex),
      backHtml: renderClozeAnswer(card.front, targetIndex),
      metaText: `Cloze (c${targetIndex})`,
    };
  }

  // Basic (and reversed card): is_reversed=true の場合はfront/backを逆転
  if (noteType === NOTE_TYPES.BASIC_REVERSED && card.is_reversed) {
    return {
      frontHtml: escapeHtml(card.back || ''),
      backHtml: escapeHtml(card.front || ''),
      metaText: 'Basic (Reversed)',
    };
  }

  // Basic（デフォルト）
  return {
    frontHtml: escapeHtml(card.front || ''),
    backHtml: escapeHtml(card.back || ''),
    metaText: noteType,
  };
}

/**
 * HTMLエスケープ
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * カードをフリップして裏面を表示する。
 */
function flipCard() {
  if (_isFlipped || _currentIndex >= _cards.length) return;

  _isFlipped = true;

  // 3Dフリップアニメーション発動 (縦)
  const container = $(STUDY_IDS.CARD_CONTAINER);
  if (container) container.classList.add('flipped');

  // 次回予定時間の計算と表示
  updateIntervalDisplay(_cards[_currentIndex]);

  // ボタン切替: 答えを見る → 評価ボタン
  const showAnswerBtn = $(STUDY_IDS.SHOW_ANSWER_BTN);
  const ratingButtons = $(STUDY_IDS.RATING_BUTTONS);
  if (showAnswerBtn) showAnswerBtn.classList.add('hidden');
  if (ratingButtons) {
    ratingButtons.classList.remove('hidden');
    ratingButtons.classList.add('animate-fade-in');
  }
}

/**
 * 評価ボタンの押下を処理する。
 * レビューをAPIに送信し、次のカードに進む。
 * @param {number} rating - 評価値（1-4）
 */
async function handleRating(rating) {
  if (_isProcessing || _currentIndex >= _cards.length) return;

  _isProcessing = true;
  const card = _cards[_currentIndex];

  try {
    await submitReview(card.id, rating);
    
    // Again(1)の場合はキューの末尾に再追加 (今日中に再出題)
    if (rating === 1) {
      _cards.push({
        ...card,
        interval_days: 0,
        repetitions: 0,
        status: 'learning'
      });
    }

    _currentIndex++;
    showCard();
  } catch (err) {
    showToast(`レビューの送信に失敗しました: ${err.message}`, 'error');
  } finally {
    _isProcessing = false;
  }
}

/**
 * 進捗バーと進捗テキストを更新する。
 */
function updateProgress() {
  const total = _cards.length;
  const current = _currentIndex + 1;
  const percent = total > 0 ? Math.round((_currentIndex / total) * 100) : 0;

  const progressText = $(STUDY_IDS.PROGRESS_TEXT);
  const progressBar = $(STUDY_IDS.PROGRESS_BAR);

  if (progressText) {
    progressText.textContent = `${current} / ${total}`;
  }
  if (progressBar) {
    const fill = progressBar.querySelector('.progress-bar-fill');
    if (fill) fill.style.width = `${percent}%`;
  }
}

/**
 * ドライラン: 次回予定時間を計算
 */
function calculateNextInterval(card, rating) {
  let ease = card.ease_factor ?? 2.5;
  let interval = card.interval_days ?? 0;
  
  if (interval === 0) {
    if (rating === 1 || rating === 2) return 0;
    if (rating === 3) return 1;
    if (rating === 4) return 4;
  } else {
    if (rating === 1) return 0;
    if (rating === 2) return Math.max(interval + 1, interval * 1.2);
    if (rating === 3) return interval * ease;
    if (rating === 4) return interval * ease * 1.3;
  }
  return 0;
}

/**
 * 期間フォーマット
 */
function formatInterval(days) {
  if (days === 0) return "< 1m";
  if (days < 1) return `${Math.round(days * 24)}h`;
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

/**
 * ボタン上の予定時間を更新
 */
function updateIntervalDisplay(card) {
  const againEl = $('study-interval-again');
  const hardEl = $('study-interval-hard');
  const goodEl = $('study-interval-good');
  const easyEl = $('study-interval-easy');

  if (againEl) againEl.textContent = formatInterval(calculateNextInterval(card, 1));
  if (hardEl) hardEl.textContent = formatInterval(calculateNextInterval(card, 2));
  if (goodEl) goodEl.textContent = formatInterval(calculateNextInterval(card, 3));
  if (easyEl) easyEl.textContent = formatInterval(calculateNextInterval(card, 4));
}

/**
 * 学習完了画面を表示する。
 */
function showComplete() {
  const cardSection = $(STUDY_IDS.CARD_SECTION);
  const completeSection = $(STUDY_IDS.COMPLETE_SECTION);

  if (cardSection) cardSection.classList.add('hidden');
  if (completeSection) {
    completeSection.classList.remove('hidden');
    completeSection.classList.add('animate-bounce-in');
  }
}

/**
 * イベントリスナーを設定する。
 */
function bindEvents() {
  // 「答えを見る」ボタン
  const showAnswerBtn = $(STUDY_IDS.SHOW_ANSWER_BTN);
  if (showAnswerBtn) {
    showAnswerBtn.addEventListener('click', flipCard);
  }

  // カードクリックでもフリップ
  const cardContainer = $(STUDY_IDS.CARD_CONTAINER);
  if (cardContainer) {
    cardContainer.addEventListener('click', () => {
      if (!_isFlipped) flipCard();
    });
  }

  // 評価ボタン
  const btnAgain = $(STUDY_IDS.BTN_AGAIN);
  const btnHard = $(STUDY_IDS.BTN_HARD);
  const btnGood = $(STUDY_IDS.BTN_GOOD);
  const btnEasy = $(STUDY_IDS.BTN_EASY);

  if (btnAgain) btnAgain.addEventListener('click', () => handleRating(1));
  if (btnHard)  btnHard.addEventListener('click',  () => handleRating(2));
  if (btnGood)  btnGood.addEventListener('click',  () => handleRating(3));
  if (btnEasy)  btnEasy.addEventListener('click',  () => handleRating(4));

  // 戻るボタン
  const backBtn = $(STUDY_IDS.BACK_BTN);
  if (backBtn) {
    backBtn.addEventListener('click', () => navigateTo('/decks'));
  }
  
  // 完了画面のデッキ一覧に戻るボタン
  const completeBackBtn = $('study-complete-back-btn');
  if (completeBackBtn) {
    completeBackBtn.addEventListener('click', () => navigateTo('/decks'));
  }

  // キーボードショートカット
  document.addEventListener('keydown', handleKeyboard);
}

/**
 * キーボードショートカットハンドラ。
 * Space: カードフリップ / 1-4: 評価送信
 * @param {KeyboardEvent} e
 */
function handleKeyboard(e) {
  // 学習画面がアクティブでない場合は無視
  const studyPage = document.getElementById('page-study');
  if (!studyPage?.classList.contains('active')) return;

  // 入力フィールドにフォーカスがある場合は無視
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

  switch (e.key) {
    case ' ':  // スペースキー
    case 'Enter':
      e.preventDefault();
      if (!_isFlipped) {
        flipCard();
      }
      break;
    case '1':
      if (_isFlipped) handleRating(1);
      break;
    case '2':
      if (_isFlipped) handleRating(2);
      break;
    case '3':
      if (_isFlipped) handleRating(3);
      break;
    case '4':
      if (_isFlipped) handleRating(4);
      break;
  }
}

/**
 * 学習モジュールを初期化する。
 */
export function init() {
  bindEvents();
}
