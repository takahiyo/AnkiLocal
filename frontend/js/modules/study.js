/**
 * modules/study.js - 学習画面（メイン機能）
 *
 * カードフリップアニメーション付きのフラッシュカード学習機能。
 * 全6ノートタイプのレンダリングに対応:
 *   Basic, Basic (and reversed card), Basic (optional reversed card),
 *   Basic (type in the answer), Cloze, Image Occlusion
 *
 * 依存: constants/index.js, services/api.js, services/cloze.js, modules/router.js
 * 参照元: main.js から init() で起動
 */

import { STUDY_IDS, NOTE_TYPES } from '../constants/index.js';
import { fetchStudyCards, submitReview, fetchDecks } from '../services/api.js';
import { goBack } from './router.js';

/* === モジュール内部状態 === */
let _cards = [];           // 学習対象カード配列
let _currentIndex = 0;     // 現在のカードインデックス
let _isFlipped = false;    // フリップ状態
let _isProcessing = false; // レビュー送信中フラグ（二重送信防止）
let _currentDeckId = null; // 現在のデッキID
let _animTimeoutId = null; // next-card-anim 解除用タイマーID
let _reviewsToday = 0;     // 本日の累積回答数（前回セッション含む）
let _dailyLimit = 0;       // 1日の出題上限（max_new_cards + max_review_cards）

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
  _reviewsToday = 0;
  _dailyLimit = 0;
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
    const data = await fetchStudyCards(deckId);
    // Handle both old format (array) and new format ({ cards, reviews_today, daily_limit })
    if (Array.isArray(data)) {
      _cards = data;
      _reviewsToday = 0;
      _dailyLimit = _cards.length;
    } else {
      _cards = Array.isArray(data.cards) ? data.cards : [];
      _reviewsToday = data.reviews_today || 0;
      _dailyLimit = data.daily_limit || _cards.length;
    }
    console.log(`[Study] Loaded ${_cards.length} cards, reviews_today=${_reviewsToday}, daily_limit=${_dailyLimit}, first card_id=${_cards[0]?.id}`);

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

  // 最初にカードコンテンツを更新
  const { frontHtml, backHtml, metaText } = renderCardContent(card);

  const frontText = $(STUDY_IDS.CARD_FRONT_TEXT);
  const backText = $(STUDY_IDS.CARD_BACK_TEXT);
  const meta = $(STUDY_IDS.CARD_META);

  if (frontText) frontText.innerHTML = frontHtml;
  if (backText) backText.innerHTML = backHtml;
  if (meta) meta.textContent = metaText;

  // アニメーション: flipped解除 → 前面表示 → next-card-anim でフェードイン
  const container = $(STUDY_IDS.CARD_CONTAINER);
  if (container) {
    if (_animTimeoutId !== null) {
      clearTimeout(_animTimeoutId);
      _animTimeoutId = null;
    }

    container.classList.remove('flipped', 'next-card-anim');
    void container.offsetHeight;
    container.classList.add('next-card-anim');

    _animTimeoutId = setTimeout(() => {
      container.classList.remove('next-card-anim');
      _animTimeoutId = null;
    }, 400);
  }

  const showAnswerBtn = $(STUDY_IDS.SHOW_ANSWER_BTN);
  const ratingButtons = $(STUDY_IDS.RATING_BUTTONS);

  // Type in the Answer: 「答えを見る」ボタンは非表示（入力フィールドのEnterでフリップ）
  const isTypeIn = card?.note_type === NOTE_TYPES.BASIC_TYPE_IN_ANSWER;
  if (showAnswerBtn) {
    if (isTypeIn) showAnswerBtn.classList.add('hidden');
    else showAnswerBtn.classList.remove('hidden');
  }
  if (ratingButtons) ratingButtons.classList.add('hidden');

  // Type in the Answer: 入力フィールドにフォーカスを当て、Enterでフリップできるようにする
  const typeInField = document.querySelector('.type-in-answer-field');
  if (typeInField) {
    typeInField.value = '';
    setTimeout(() => typeInField.focus(), 100);
    typeInField.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        flipCard();
      }
    };
  }

  updateProgress();
}

/**
 * ノートタイプに応じたカードコンテンツをレンダリングする。
 * @param {object} card - カードオブジェクト {note_type, front, back, cloze_index, is_reversed}
 * @returns {{ frontHtml: string, backHtml: string, metaText: string }}
 */
function renderCardContent(card) {
  const noteType = card.note_type || NOTE_TYPES.BASIC;

  // Clozeタイプ（サーバー側で既にレンダリング済みのため直接表示）
  if (noteType === NOTE_TYPES.CLOZE) {
    const targetIndex = card.cloze_index || 1;
    let frontHtml = htmlLineBreaks(card.front || '');
    let backHtml = card.back || '';

    // サーバー側で <span> が付与されていない場合（既存データ）、
    // [...] や [hint] を cloze-placeholder でラップする
    if (!frontHtml.includes('cloze-placeholder')) {
      frontHtml = frontHtml.replace(/\[([^\]]*)\]/g, '<span class="cloze-placeholder">[$1]</span>');
    }

    // 解答面の <strong> に青色を常に適用（既存データ互換）
    backHtml = backHtml.replace(/<strong\b[^>]*>/g, '<strong style="color: #1976D2;">');

    return {
      frontHtml,
      backHtml,
      metaText: `Cloze (c${targetIndex})`,
    };
  }

  // Basic (type in the answer) - 表面に入力フォームを表示
  if (noteType === NOTE_TYPES.BASIC_TYPE_IN_ANSWER) {
    return {
      frontHtml: `
        ${htmlLineBreaks(card.front || '')}
        <div class="type-in-answer-input" style="margin-top: var(--spacing-lg);">
          <input type="text" class="type-in-answer-field"
                 placeholder="答えを入力..."
                 autocomplete="off" autocorrect="off" spellcheck="false"
                 style="width: 100%; max-width: 400px; padding: var(--spacing-md);
                        font-size: var(--font-size-lg); border: 2px solid var(--border-glass);
                        border-radius: var(--radius-md); background: var(--bg-glass);
                        color: var(--text-primary); outline: none;">
        </div>
      `,
      backHtml: `
        ${htmlLineBreaks(card.front || '')}
        <hr id="answer">
        <div class="type-in-answer-correct">${htmlLineBreaks(card.back || '')}</div>
      `,
      metaText: 'Type in the Answer',
    };
  }

  // Image Occlusion - front=画像URL, back=メタデータJSON
  if (noteType === NOTE_TYPES.IMAGE_OCCLUSION) {
    try {
      const imageSrc = card.front || ''; // 画像URL（notes.ts で front に格納）
      const meta = JSON.parse(card.back || '{}'); // メタデータ（back に格納）
      const occlusions = JSON.parse(meta.occlusionData || '[]');
      const activeMaskId = meta.activeMaskId;

      return {
        frontHtml: renderOcclusionSvg(imageSrc, occlusions, activeMaskId, true),
        backHtml: renderOcclusionSvg(imageSrc, occlusions, activeMaskId, false),
        metaText: `Image Occlusion (${activeMaskId || ''})`,
      };
    } catch {
      return {
        frontHtml: escapeHtml(card.front || ''),
        backHtml: escapeHtml(card.back || ''),
        metaText: 'Image Occlusion',
      };
    }
  }

  // Basic / Basic (and reversed card) / Basic (optional reversed card)
  // パーサーが既にfront/backを入れ替えて生成しているため、そのまま表示する
  // reversed カードは meta に "(Reversed)" を付加して識別可能にする
  const revLabel = card.is_reversed ? ' (Reversed)' : '';
  return {
    frontHtml: htmlLineBreaks(card.front || ''),
    backHtml: htmlLineBreaks(card.back || ''),
    metaText: `${noteType}${revLabel}`,
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
 * 改行を<br>に変換しつつHTMLはエスケープしない（カード本文用）。
 * 既存の<br>タグはそのまま保持、\nは<br>に変換する。
 * @param {string} str
 * @returns {string}
 */
function htmlLineBreaks(str) {
  return str.replace(/<br\s*\/?>/gi, '<br>').replace(/\n/g, '<br>');
}

/**
 * Image Occlusion 用のSVGマスクHTMLを生成する。
 * @param {string} imageSrc - ベース画像のURL
 * @param {Array} occlusions - マスクデータ配列
 * @param {string} activeMaskId - アクティブなマスクID
 * @param {boolean} isFront - 表面かどうか（表面はアクティブマスクを赤、非アクティブを黄で隠す）
 * @returns {string} HTML文字列
 */
function renderOcclusionSvg(imageSrc, occlusions, activeMaskId, isFront) {
  if (!imageSrc) return '<div class="text-muted">No image data</div>';

  const firstMask = occlusions[0] || {};
  const imgW = firstMask.originalWidth || firstMask.x + (firstMask.width || 0) + 100 || 800;
  const imgH = firstMask.originalHeight || firstMask.y + (firstMask.height || 0) + 100 || 600;

  const masksSvg = occlusions.map((mask) => {
    const isActive = mask.id === activeMaskId;
    if (isActive && !isFront) {
      return `<rect x="${mask.x}" y="${mask.y}" width="${mask.width}" height="${mask.height}"
                    fill="none" stroke="var(--color-success)" stroke-width="2"
                    stroke-dasharray="4,2" rx="2" />`;
    }
    if (isActive && isFront) {
      return `<rect x="${mask.x}" y="${mask.y}" width="${mask.width}" height="${mask.height}"
                    fill="var(--color-danger)" opacity="0.85" rx="2" />`;
    }
    return `<rect x="${mask.x}" y="${mask.y}" width="${mask.width}" height="${mask.height}"
                  fill="var(--color-warning)" opacity="0.7" rx="2" />`;
  }).join('');

  return `
    <div class="occlusion-container" style="position: relative; max-width: 100%;">
      <img src="${escapeAttr(imageSrc)}" alt="Occlusion image"
           style="width: 100%; height: auto; display: block; border-radius: var(--radius-md);"
           onerror="this.parentElement.innerHTML='<div class=\\'text-muted\\'>Image not found</div>'">
      <svg viewBox="0 0 ${imgW} ${imgH}"
           style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;">
        ${masksSvg}
      </svg>
    </div>
  `;
}

/**
 * HTML属性エスケープ
 * @param {string} str
 * @returns {string}
 */
function escapeAttr(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/**
 * Type in the Answer の入力テキストと正解の差分を視覚的に表示する。
 * 簡易的な文字単位の差分ハイライト。
 * @param {string} userInput - ユーザーの入力
 * @param {string} correctAnswer - 正しい答え
 * @returns {string} HTML文字列
 */
function renderTypeInDiff(userInput, correctAnswer) {
  const container = document.createElement('div');
  container.style.cssText = 'font-family: monospace; font-size: var(--font-size-lg); text-align: center;';

  if (userInput === correctAnswer) {
    container.innerHTML = `<span style="background: var(--color-success); color: white; padding: 2px 6px; border-radius: 3px;">${escapeHtml(correctAnswer)}</span> <span style="color: var(--color-success); margin-left: 8px;">&#10003; Correct!</span>`;
    return container.outerHTML;
  }

  // 簡易文字差分（LCSなしのシンプル版）
  const maxLen = Math.max(userInput.length, correctAnswer.length);
  let result = '';
  for (let i = 0; i < maxLen; i++) {
    const u = userInput[i] || '';
    const c = correctAnswer[i] || '';
    if (u === c) {
      result += `<span style="color: var(--color-success);">${escapeHtml(u)}</span>`;
    } else {
      if (u) result += `<span style="background: var(--color-danger); color: white; text-decoration: line-through; padding: 0 2px; border-radius: 2px;">${escapeHtml(u)}</span>`;
      if (c) result += `<span style="background: var(--color-warning); color: var(--text-primary); padding: 0 2px; border-radius: 2px;">${escapeHtml(c)}</span>`;
    }
  }
  container.innerHTML = `
    <div style="margin-bottom: var(--spacing-sm);">
      <span style="color: var(--text-secondary); font-size: var(--font-size-sm);">Your answer:</span><br>
      <span>${escapeHtml(userInput) || '<em style="color: var(--text-muted);">(empty)</em>'}</span>
    </div>
    <div style="margin-bottom: var(--spacing-sm);">
      <span style="color: var(--text-secondary); font-size: var(--font-size-sm);">Correct answer:</span><br>
      <span>${escapeHtml(correctAnswer)}</span>
    </div>
    <div>
      <span style="color: var(--text-secondary); font-size: var(--font-size-sm);">Difference:</span><br>
      ${result}
    </div>
  `;
  return container.outerHTML;
}

/**
 * カードをフリップして裏面を表示する。
 */
function flipCard() {
  if (_isFlipped || _currentIndex >= _cards.length) return;

  _isFlipped = true;
  const card = _cards[_currentIndex];
  console.log(`[Study] flipCard: index=${_currentIndex}, card_id=${card?.id}`);

  // Type in the Answer: 入力内容を取得して裏面に差分表示
  if (card?.note_type === NOTE_TYPES.BASIC_TYPE_IN_ANSWER) {
    const typeInField = document.querySelector('.type-in-answer-field');
    const backText = $(STUDY_IDS.CARD_BACK_TEXT);
    if (typeInField && backText) {
      const userInput = typeInField.value.trim();
      const correctAnswer = card.back || '';
      backText.innerHTML = `
        ${escapeHtml(card.front || '')}
        <hr id="answer">
        ${renderTypeInDiff(userInput, correctAnswer)}
      `;
    }
  }

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
  const total = _dailyLimit || _cards.length;
  const current = _reviewsToday + _currentIndex + 1;
  const percent = total > 0 ? Math.min(Math.round(((_reviewsToday + _currentIndex) / total) * 100), 100) : 0;

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

  // カードクリックでもフリップ（ただしType-in-the-Answerは入力フォームへのフォーカスと競合するため除外）
  const cardContainer = $(STUDY_IDS.CARD_CONTAINER);
  if (cardContainer) {
    cardContainer.addEventListener('click', () => {
      if (!_isFlipped) {
        const card = _cards[_currentIndex];
        if (card?.note_type === NOTE_TYPES.BASIC_TYPE_IN_ANSWER) return;
        flipCard();
      }
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
