import { IMPORT_IDS } from '../constants/index.js';
import { previewImportFile, importFile } from '../services/api.js';

function showToast(message, type = 'info') {
  if (typeof window._showToast === 'function') {
    window._showToast(message, type);
  }
}

function $(id) {
  return document.getElementById(id);
}

let currentFile = null;
let currentPreviewData = null;

async function handleFile(file) {
  if (!file.name.endsWith('.txt')) {
    showToast('テキストファイル(.txt)のみインポートできます', 'warning');
    return;
  }

  currentFile = file;
  const loading = $(IMPORT_IDS.LOADING);
  const dropZone = $(IMPORT_IDS.DROP_ZONE);
  const preview = $(IMPORT_IDS.PREVIEW);
  const result = $(IMPORT_IDS.RESULT);

  if (loading) loading.classList.remove('hidden');
  if (dropZone) dropZone.classList.add('hidden');
  if (preview) preview.classList.add('hidden');
  if (result) result.classList.add('hidden');

  try {
    const data = await previewImportFile(file);
    currentPreviewData = data;
    showPreview(data);
  } catch (err) {
    showToast(`ファイル解析に失敗しました: ${err.message}`, 'error');
    if (dropZone) dropZone.classList.remove('hidden');
  } finally {
    if (loading) loading.classList.add('hidden');
  }
}

function showPreview(data) {
  const preview = $(IMPORT_IDS.PREVIEW);
  const content = $(IMPORT_IDS.PREVIEW_CONTENT);
  const modeContainer = $(IMPORT_IDS.MODE_CONTAINER);

  if (!preview || !content) return;

  const newCount = data.summary?.new_count || 0;
  const existingCount = data.summary?.existing_count || 0;
  const total = data.summary?.total || 0;
  const decks = data.decks || [];

  if (data.summary && data.cards) {
    window._importPreviewCards = data.cards;
  }

  let deckList = '';
  if (decks.length > 0) {
    deckList = `
      <div style="margin-top: var(--spacing-lg);">
        <h4 style="margin-bottom: var(--spacing-sm); font-size: var(--font-size-base);">検出されたデッキ</h4>
        ${decks.map((name) => `
          <div style="display: flex; justify-content: space-between; align-items: center;
                      padding: var(--spacing-sm) var(--spacing-md);
                      border-bottom: 1px solid var(--border-glass);">
            <span style="color: var(--text-primary);">${escapeHtml(name || 'Unknown')}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  content.innerHTML = `
    <div class="animate-fade-in">
      <div style="display: flex; gap: var(--spacing-lg); justify-content: center; margin-bottom: var(--spacing-lg);">
        <div class="stat-card" style="flex: 1; max-width: 180px; cursor: pointer;" title="クリックで一覧表示">
          <div class="stat-value" style="color: var(--color-success);">${newCount}</div>
          <div class="stat-label">新規</div>
        </div>
        <div class="stat-card" style="flex: 1; max-width: 180px; cursor: pointer;" title="クリックで一覧表示">
          <div class="stat-value" style="color: ${existingCount > 0 ? 'var(--color-warning)' : 'var(--text-muted)'};">${existingCount}</div>
          <div class="stat-label">更新対象</div>
        </div>
      </div>
      <p style="text-align: center; color: var(--text-secondary); margin-bottom: var(--spacing-sm);">
        合計 ${total} 枚のカードを検出しました
      </p>
      <p style="text-align: center; color: var(--text-secondary); font-size: var(--font-size-small);">
        ファイル: ${escapeHtml(currentFile?.name || '')}
      </p>
      ${deckList}
    </div>
  `;

  preview.classList.remove('hidden');

  if (existingCount > 0) {
    modeContainer.classList.remove('hidden');
    $(IMPORT_IDS.MODE_SKIP).checked = true;
  } else {
    modeContainer.classList.add('hidden');
  }
}

async function handleExecute() {
  if (!currentFile) return;

  const modeEl = document.querySelector('input[name="import-mode"]:checked');
  const mode = modeEl ? modeEl.value : 'skip';

  const preview = $(IMPORT_IDS.PREVIEW);
  const loading = $(IMPORT_IDS.LOADING);
  const result = $(IMPORT_IDS.RESULT);

  if (preview) preview.classList.add('hidden');
  if (loading) {
    loading.querySelector('p').textContent = 'データベースへ登録中...';
    loading.classList.remove('hidden');
  }
  if (result) result.classList.add('hidden');

  try {
    const data = await importFile(currentFile, mode);
    showResult(data);
    const count = data.imported_count || 0;
    showToast(`${count}枚のカードをインポートしました`, 'success');
  } catch (err) {
    showToast(`インポートに失敗しました: ${err.message}`, 'error');
    if (preview) preview.classList.remove('hidden');
  } finally {
    if (loading) {
      loading.querySelector('p').textContent = 'ファイルを解析中...';
      loading.classList.add('hidden');
    }
  }
}

function showResult(data) {
  const result = $(IMPORT_IDS.RESULT);
  const content = $(IMPORT_IDS.RESULT_CONTENT);
  if (!result || !content) return;

  const imported = data.imported_count || 0;
  const skipped = data.skipped_count || 0;
  const updated = data.updated_count || 0;
  const mode = data.mode || 'skip';
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

  let statsHtml = '';
  if (mode === 'skip') {
    statsHtml = `
      <div style="display: flex; gap: var(--spacing-lg); justify-content: center; margin-bottom: var(--spacing-lg);">
        <div class="stat-card" style="flex: 1; max-width: 180px;">
          <div class="stat-value" style="color: var(--color-success);">${imported}</div>
          <div class="stat-label">新規作成</div>
        </div>
        <div class="stat-card" style="flex: 1; max-width: 180px;">
          <div class="stat-value" style="color: var(--color-warning);">${skipped}</div>
          <div class="stat-label">スキップ</div>
        </div>
      </div>
    `;
  } else {
    statsHtml = `
      <div style="display: flex; gap: var(--spacing-lg); justify-content: center; margin-bottom: var(--spacing-lg);">
        <div class="stat-card" style="flex: 1; max-width: 180px;">
          <div class="stat-value" style="color: var(--color-success);">${imported}</div>
          <div class="stat-label">新規作成</div>
        </div>
        <div class="stat-card" style="flex: 1; max-width: 180px;">
          <div class="stat-value" style="color: var(--color-info);">${updated}</div>
          <div class="stat-label">更新</div>
        </div>
      </div>
    `;
  }

  content.innerHTML = `
    <div class="animate-fade-in">
      <div style="text-align: center; margin-bottom: var(--spacing-xl);">
        <div style="font-size: 3rem; margin-bottom: var(--spacing-sm);">✅</div>
        <h3 style="margin-bottom: var(--spacing-sm);">インポート完了</h3>
      </div>
      ${statsHtml}
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

  const retryBtn = document.getElementById('import-retry-btn');
  if (retryBtn) {
    retryBtn.addEventListener('click', resetImportView);
  }
}

function resetImportView() {
  currentFile = null;
  currentPreviewData = null;
  const dropZone = $(IMPORT_IDS.DROP_ZONE);
  const preview = $(IMPORT_IDS.PREVIEW);
  const result = $(IMPORT_IDS.RESULT);
  const modeContainer = $(IMPORT_IDS.MODE_CONTAINER);

  if (dropZone) dropZone.classList.remove('hidden');
  if (preview) preview.classList.add('hidden');
  if (result) result.classList.add('hidden');
  if (modeContainer) modeContainer.classList.add('hidden');

  const fileInput = $(IMPORT_IDS.FILE_INPUT);
  if (fileInput) fileInput.value = '';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function bindEvents() {
  const dropZone = $(IMPORT_IDS.DROP_ZONE);
  const fileInput = $(IMPORT_IDS.FILE_INPUT);
  const fileBtn = $(IMPORT_IDS.FILE_BTN);
  const executeBtn = $(IMPORT_IDS.EXECUTE_BTN);
  const cancelBtn = document.getElementById('import-cancel-btn');

  if (!dropZone) return;

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
      handleFile(files[0]);
    }
  });

  dropZone.addEventListener('click', () => {
    fileInput?.click();
  });

  if (fileBtn) {
    fileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput?.click();
    });
  }

  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        handleFile(files[0]);
      }
    });
  }

  if (executeBtn) {
    executeBtn.addEventListener('click', handleExecute);
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', resetImportView);
  }
}

export function resetView() {
  resetImportView();
}

export function init() {
  bindEvents();
}
