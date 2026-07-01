/**
 * modules/import.js - インポート画面
 *
 * ドラッグ＆ドロップまたはファイル選択によるtxtファイルのアップロード。
 * インポート中のローディングアニメーション、結果表示（インポート数、スキップ数、デッキ別内訳）。
 *
 * 依存: constants/dom.js, services/api.js
 * 参照元: main.js から init() で起動
 */

import { IMPORT_IDS } from '../constants/index.js';
import { importFile } from '../services/api.js';

/**
 * トースト通知
 */
function showToast(message, type = 'info') {
  if (typeof window._showToast === 'function') {
    window._showToast(message, type);
  }
}

/**
 * DOM要素取得ヘルパー
 * @param {string} id
 * @returns {HTMLElement|null}
 */
function $(id) {
  return document.getElementById(id);
}

/**
 * ファイルのインポート処理を実行する。
 * @param {File} file - アップロードするファイルオブジェクト
 */
async function handleImport(file) {
  // ファイル形式のバリデーション
  if (!file.name.endsWith('.txt')) {
    showToast('テキストファイル(.txt)のみインポートできます', 'warning');
    return;
  }

  const loading = $(IMPORT_IDS.LOADING);
  const result = $(IMPORT_IDS.RESULT);
  const dropZone = $(IMPORT_IDS.DROP_ZONE);

  // ローディング表示
  if (loading) loading.classList.remove('hidden');
  if (result) result.classList.add('hidden');
  if (dropZone) dropZone.classList.add('hidden');

  try {
    const data = await importFile(file);
    showResult(data);
    showToast(`${data.imported_count || 0}枚のカードをインポートしました`, 'success');
  } catch (err) {
    showToast(`インポートに失敗しました: ${err.message}`, 'error');
    // ドロップゾーンを再表示
    if (dropZone) dropZone.classList.remove('hidden');
  } finally {
    if (loading) loading.classList.add('hidden');
  }
}

/**
 * インポート結果を表示する。
 * @param {object} data - {imported_count, skipped_count, decks: [...]}
 */
function showResult(data) {
  const result = $(IMPORT_IDS.RESULT);
  const content = $(IMPORT_IDS.RESULT_CONTENT);

  if (!result || !content) return;

  const imported = data.imported_count || 0;
  const skipped = data.skipped_count || 0;
  const decks = data.decks || [];

  let deckList = '';
  if (decks.length > 0) {
    deckList = `
      <div style="margin-top: var(--spacing-lg);">
        <h4 style="margin-bottom: var(--spacing-sm); font-size: var(--font-size-base);">デッキ別内訳</h4>
        ${decks.map((d) => `
          <div style="display: flex; justify-content: space-between; align-items: center;
                      padding: var(--spacing-sm) var(--spacing-md);
                      border-bottom: 1px solid var(--border-glass);">
            <span style="color: var(--text-primary);">${escapeHtml(d.name || 'Unknown')}</span>
            <span class="badge badge-new">${d.card_count || 0}枚</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  content.innerHTML = `
    <div class="animate-fade-in">
      <div style="text-align: center; margin-bottom: var(--spacing-xl);">
        <div style="font-size: 3rem; margin-bottom: var(--spacing-sm);">✅</div>
        <h3 style="margin-bottom: var(--spacing-sm);">インポート完了</h3>
      </div>
      <div style="display: flex; gap: var(--spacing-lg); justify-content: center; margin-bottom: var(--spacing-lg);">
        <div class="stat-card" style="flex: 1; max-width: 180px;">
          <div class="stat-value" style="color: var(--color-success);">${imported}</div>
          <div class="stat-label">インポート済み</div>
        </div>
        <div class="stat-card" style="flex: 1; max-width: 180px;">
          <div class="stat-value" style="color: var(--color-warning);">${skipped}</div>
          <div class="stat-label">スキップ</div>
        </div>
      </div>
      ${deckList}
      <div style="display: flex; gap: var(--spacing-md); justify-content: center; margin-top: var(--spacing-xl);">
        <button class="btn btn-primary" onclick="window.location.hash='#/decks'">
          📚 デッキ一覧へ
        </button>
        <button class="btn btn-secondary" id="import-retry-btn">
          📥 もう一度インポート
        </button>
      </div>
    </div>
  `;

  result.classList.remove('hidden');

  // 「もう一度インポート」ボタンのイベント
  const retryBtn = document.getElementById('import-retry-btn');
  if (retryBtn) {
    retryBtn.addEventListener('click', resetImportView);
  }
}

/**
 * インポート画面をリセットしてドロップゾーンを再表示する。
 */
function resetImportView() {
  const dropZone = $(IMPORT_IDS.DROP_ZONE);
  const result = $(IMPORT_IDS.RESULT);

  if (dropZone) dropZone.classList.remove('hidden');
  if (result) result.classList.add('hidden');

  // ファイル入力をリセット
  const fileInput = $(IMPORT_IDS.FILE_INPUT);
  if (fileInput) fileInput.value = '';
}

/**
 * HTMLエスケープ
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * ドラッグ＆ドロップおよびファイル選択のイベントリスナーを設定する。
 */
function bindEvents() {
  const dropZone = $(IMPORT_IDS.DROP_ZONE);
  const fileInput = $(IMPORT_IDS.FILE_INPUT);
  const fileBtn = $(IMPORT_IDS.FILE_BTN);

  if (!dropZone) return;

  // ⚠️ WARNING: preventDefault() は必須。これがないとブラウザがファイルを直接開いてしまう
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');

    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      handleImport(files[0]);
    }
  });

  // ドロップゾーンクリックでもファイル選択を起動
  dropZone.addEventListener('click', () => {
    fileInput?.click();
  });

  // ファイル選択ボタン
  if (fileBtn) {
    fileBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // ドロップゾーンのクリックイベントと衝突防止
      fileInput?.click();
    });
  }

  // ファイル入力のchangeイベント
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        handleImport(files[0]);
      }
    });
  }
}

/**
 * インポート画面の表示をリセットする（画面遷移時）。
 */
export function resetView() {
  resetImportView();
}

/**
 * インポートモジュールを初期化する。
 */
export function init() {
  bindEvents();
}
