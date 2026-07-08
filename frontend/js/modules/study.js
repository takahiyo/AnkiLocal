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
import { goBack } from './router.js';

/* === モジュール内部状態 === */
let _cards = [];           // 学習対象カード配列
let _currentIndex = 0;     // 現在のカードインデックス
let _isFlipped = false;    // フリップ状態
let _isProcessing = false; // レビュー送信中フラグ（二重送信防止）
let _currentDeckId = null; // 現在のデッキID
let _animTimeoutId = null; // next-card-anim 解除用タイマーID

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
  _isProcessing = false;
  _cards = [];
  if (_animTimeoutId !== null) {
    clearTimeout(_animTimeoutId);
    _animTimeoutId = null;
  }

  // UIリセット
  const cardSection = $(STUDY_IDS.CARD_SECTION);
  const completeSection = $(STUDY_IDS.COMPLETE_SECTION);
  if (cardSection) cardSection.classList.add('hidden');
  if (completeSection) completeSection.classList.add('hidden');

  try {
    _cards = await fetchStudyCards(deckId);
    console.log(`[Study] Loaded ${_cards.length} cards, first card_id=${_cards[0]?.id}`);

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
      console.log('[Study] No cards, showing complete');
      showComplete();
      return;
    }

    // データ準備ができてからカード表示領域を表示し、最初のカードを描画
    if (cardSection) cardSection.classList.remove('hidden');
    showCard();
  } catch (err) {
    showToast(`カードの取得に失敗しました: ${err.message}`, 'error');
  }
}

/**
 * 現在のカードを表示する（表面）。
 */
function showCard() {
  console.log(`[Study] showCard: _currentIndex=${_currentIndex}, _cards.length=${_cards.length}, _isFlipped=${_isFlipped}, _isProcessing=${_isProcessing}`);

  if (_currentIndex >= _cards.length) {
    console.log('[Study] Index out of range, showing complete');
    showComplete();
    return;
  }

  const card = _cards[_currentIndex];
  if (!card) {
    console.error('[Study] Card is undefined at index', _currentIndex);
    showToast('カードデータの読み込みに失敗しました', 'error');
    return;
  }

  console.log(`[Study] Showing card id=${card.id}, note_type=${card.note_type}, front.length=${(card.front||'').length}`);

  _isFlipped = false;
  _isProcessing = false;

  // 最初にカードコンテンツを更新（旧コンテンツが残らないように）
  const { frontHtml, backHtml, metaText } = renderCardContent(card);

  const frontText = $(STUDY_IDS.CARD_FRONT_TEXT);
  const backText = $(STUDY_IDS.CARD_BACK_TEXT);
  const meta = $(STUDY_IDS.CARD_META);

  if (frontText) frontText.innerHTML = frontHtml;
  if (backText) backText.innerHTML = backHtml;
  if (meta) meta.textContent = metaText;

  // 次にアニメーション状態をリセット
  const container = $(STUDY_IDS.CARD_CONTAINER);
  if (container) {
    // 前回の next-card-anim 解除タイマーを確実にキャンセル
    if (_animTimeoutId !== null) {
      clearTimeout(_animTimeoutId);
      _animTimeoutId = null;
    }

    // transitionを無効化して強制的に表面にスナップさせる
    const inner = container.querySelector('.study-card-inner');
    if (inner) {
      inner.style.transition = 'none';
      inner.style.transform = 'none';  // <-- 'none' でCSSの rotateX(180deg) をinline上書き
      void inner.offsetHeight;         // reflow: 即座に前面へスナップ
    }

    // flippedを解除（inlineが効いているので既に前面だが、クリーンに）
    container.classList.remove('flipped', 'next-card-anim');

    // inline解除 → 次のカード演出に移行
    if (inner) {
      inner.style.transform = '';      // inline削除
      inner.style.transition = '';     // transition再開
    }
    void container.offsetHeight;
    container.classList.add('next-card-anim');

    _animTimeoutId = setTimeout(() => {
      container.classList.remove('next-card-anim');
      _animTimeoutId = null;
    }, 400);
  }

  const showAnswerBtn = $(STUDY_IDS.SHOW_ANSWER_BTN);
  const ratingButtons = $(STUDY_IDS.RATING_BUTTONS);
  if (showAnswerBtn) showAnswerBtn.classList.remove('hidden');
  if (ratingButtons) ratingButtons.classList.add('hidden');

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

  // Basic（デフォルト）
  // ※パーサーが is_reversed=true のカードで既にfront/backを入れ替えて生成しているため、
  //   フロントエンドではそのまま表示する
  return {
    frontHtml: escapeHtml(card.front || ''),
    backHtml: escapeHtml(card.back || ''),
    metaText: noteType,
  };
}

/**
 * HTMLエスケープ（<br>タグと\n改行を保持）
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  // <br>タグを一時プレースホルダーに置換
  const brPlaceholder = '___BR_PLACEHOLDER___';
  let processed = str.replace(/<br\s*\/?>/gi, brPlaceholder);
  // \n改行を<br>に変換
  processed = processed.replace(/\n/g, brPlaceholder);

  // HTMLエスケープ
  const div = document.createElement('div');
  div.textContent = processed;
  let escaped = div.innerHTML;

  // プレースホルダーを実際の<br>に復元
  escaped = escaped.replace(new RegExp(brPlaceholder, 'g'), '<br>');

  return escaped;
}

/**
 * カードをフリップして裏面を表示する。
 */
function flipCard() {
  if (_isFlipped || _currentIndex >= _cards.length) return;

  _isFlipped = true;
  console.log(`[Study] flipCard: index=${_currentIndex}, card_id=${_cards[_currentIndex]?.id}`);

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
  if (_isProcessing || _currentIndex >= _cards.length) {
    console.log(`[Study] handleRating blocked: _isProcessing=${_isProcessing}, _currentIndex=${_currentIndex}, _cards.length=${_cards.length}`);
    return;
  }

  _isProcessing = true;
  const card = _cards[_currentIndex];

  if (!card) {
    console.error('[Study] handleRating: card is undefined at index', _currentIndex);
    _isProcessing = false;
    return;
  }

  console.log(`[Study] handleRating: rating=${rating}, card_id=${card.id}, index=${_currentIndex}`);
  console.log(`[Study]   front preview: ${(card.front||'').substring(0, 50)}`);

  try {
    const result = await submitReview(card.id, rating);
    console.log(`[Study] Review submitted OK: card_id=${result.card_id}, status=${result.status}`);

    // Again(1)の場合はキューの末尾に再追加 (今日中に再出題)
    if (rating === 1) {
      const cloneCard = {
        ...card,
        interval_days: 0,
        repetitions: 0,
        status: 'learning'
      };
      _cards.push(cloneCard);
      console.log(`[Study] Re-added card ${card.id} to queue end, queue now ${_cards.length}`);
    }

    _currentIndex++;
    console.log(`[Study] Advancing to index ${_currentIndex} (total ${_cards.length})`);

    showCard();
  } catch (err) {
    console.error('[Study] Review submission failed:', err);
    showToast(`レビューの送信に失敗しました: ${err.message}`, 'error');
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
 * 期間フォーマット（日本語）
 */
function formatInterval(days) {
  if (days === 0) return "1分後";
  if (days < 1) return `${Math.round(days * 24)}時間後`;
  if (days < 30) return `${Math.round(days)}日後`;
  if (days < 365) return `${Math.round(days / 30)}ヶ月後`;
  return `${(days / 365).toFixed(1)}年後`;
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
  if (_animTimeoutId !== null) {
    clearTimeout(_animTimeoutId);
    _animTimeoutId = null;
  }
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
    backBtn.addEventListener('click', () => goBack('/decks'));
  }
  
  // 完了画面のデッキ一覧に戻るボタン
  const completeBackBtn = $('study-complete-back-btn');
  if (completeBackBtn) {
    completeBackBtn.addEventListener('click', () => goBack('/decks'));
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

  // レビュー送信中は無視
  if (_isProcessing) return;

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
