/**
 * modules/admin.js - 管理者画面
 *
 * ユーザーアカウントの管理（一覧表示、削除、パスワード変更、学習状態リセット）
 *
 * 依存: constants/api.js, services/api.js
 * 参照元: main.js から init() で起動
 */

import { fetchAdminUsers, deleteAdminUser, changeUserPassword, resetUserLearning } from '../services/api.js';

function showToast(message, type = 'info') {
  if (typeof window._showToast === 'function') {
    window._showToast(message, type);
  }
}

function $(id) {
  return document.getElementById(id);
}

let confirmCallback = null;

function showConfirmDialog(message, onConfirm) {
  const overlay = $('admin-confirm-overlay');
  const messageEl = $('admin-confirm-message');
  const yesBtn = $('admin-confirm-yes');
  const noBtn = $('admin-confirm-no');

  if (!overlay || !messageEl) return;

  messageEl.textContent = message;
  confirmCallback = onConfirm;
  overlay.classList.add('active');

  const handler = () => {
    overlay.classList.remove('active');
    if (yesBtn) yesBtn.removeEventListener('click', handler);
    if (noBtn) noBtn.removeEventListener('click', handler);
    const cb = confirmCallback;
    confirmCallback = null;
    if (cb) cb();
  };

  if (yesBtn) {
    yesBtn.onclick = null;
    yesBtn.addEventListener('click', handler);
  }
  if (noBtn) {
    noBtn.onclick = null;
    noBtn.addEventListener('click', () => {
      overlay.classList.remove('active');
      confirmCallback = null;
      if (yesBtn) yesBtn.removeEventListener('click', handler);
    });
  }
}

function showPasswordDialog(userId, username) {
  const overlay = $('admin-password-overlay');
  const titleEl = $('admin-password-title');
  const inputEl = $('admin-password-input');
  const confirmEl = $('admin-password-confirm');
  const errorEl = $('admin-password-error');
  const submitBtn = $('admin-password-submit');
  const cancelBtn = $('admin-password-cancel');

  if (!overlay) return;

  titleEl.textContent = `${username} のパスワード変更`;
  inputEl.value = '';
  confirmEl.value = '';
  errorEl.classList.add('hidden');

  overlay.classList.add('active');

  const close = () => {
    overlay.classList.remove('active');
  };

  const handleSubmit = async () => {
    const pw = inputEl.value.trim();
    const pw2 = confirmEl.value.trim();
    errorEl.classList.add('hidden');

    if (!pw) {
      errorEl.textContent = 'パスワードを入力してください';
      errorEl.classList.remove('hidden');
      return;
    }
    if (pw !== pw2) {
      errorEl.textContent = 'パスワードが一致しません';
      errorEl.classList.remove('hidden');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = '変更中...';
    try {
      const result = await changeUserPassword(userId, pw);
      showToast(result.message || 'パスワードを変更しました', 'success');
      close();
      loadUsers();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = '変更';
    }
  };

  submitBtn.onclick = handleSubmit;
  cancelBtn.onclick = close;
}

async function loadUsers() {
  const tbody = $('admin-users-tbody');
  const loading = $('admin-loading');
  const container = $('admin-users-table');

  if (!tbody) return;
  if (loading) loading.style.display = '';
  if (container) container.style.display = 'none';

  try {
    const users = await fetchAdminUsers();
    const currentAuth = JSON.parse(localStorage.getItem('anki_local_is_admin') || 'false');

    tbody.innerHTML = users
      .map(
        (u) => `
        <tr>
          <td>${escapeHtml(u.username)}</td>
          <td>${u.is_admin ? '<span class="badge badge-learning">管理者</span>' : '<span class="badge badge-new">一般</span>'}</td>
          <td>${u.logged_in ? '<span style="color: var(--color-success);">オンライン</span>' : '<span style="color: var(--text-muted);">オフライン</span>'}</td>
          <td>${formatDate(u.created_at)}</td>
          <td class="admin-actions-cell">
            <button class="btn btn-sm btn-secondary admin-action-btn" data-action="password" data-id="${u.id}" data-name="${escapeHtml(u.username)}">🔑 パスワード</button>
            <button class="btn btn-sm btn-secondary admin-action-btn" data-action="reset" data-id="${u.id}" data-name="${escapeHtml(u.username)}">🔄 リセット</button>
            ${!u.is_admin ? `<button class="btn btn-sm btn-secondary admin-action-btn" data-action="delete" data-id="${u.id}" data-name="${escapeHtml(u.username)}" style="color: var(--color-error);">🗑 削除</button>` : ''}
          </td>
        </tr>`
      )
      .join('');

    // イベント委譲
    tbody.querySelectorAll('.admin-action-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        const userId = parseInt(btn.dataset.id, 10);
        const userName = btn.dataset.name;

        if (action === 'delete') {
          showConfirmDialog(`アカウント「${userName}」を削除しますか？\nすべての学習データが失われます。`, async () => {
            try {
              const result = await deleteAdminUser(userId);
              showToast(result.message, 'success');
              loadUsers();
            } catch (err) {
              showToast(err.message, 'error');
            }
          });
        } else if (action === 'reset') {
          showConfirmDialog(`アカウント「${userName}」の学習状態をリセットしますか？`, async () => {
            try {
              const result = await resetUserLearning(userId);
              showToast(result.message, 'success');
              loadUsers();
            } catch (err) {
              showToast(err.message, 'error');
            }
          });
        } else if (action === 'password') {
          showPasswordDialog(userId, userName);
        }
      });
    });
  } catch (err) {
    showToast(`ユーザー一覧取得エラー: ${err.message}`, 'error');
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: var(--spacing-xl); color: var(--text-secondary);">読み込みに失敗しました</td></tr>`;
  } finally {
    if (loading) loading.style.display = 'none';
    if (container) container.style.display = '';
  }
}

function formatDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * 管理者画面の表示をリセットする（画面遷移時）。
 */
export function resetView() {
  loadUsers();
}

/**
 * 管理者モジュールを初期化する。
 */
export function init() {
  // パスワード変更モーダルのEnterキー対応
  const pwInput = $('admin-password-input');
  const pwConfirm = $('admin-password-confirm');
  if (pwInput && pwConfirm) {
    pwConfirm.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        $('admin-password-submit')?.click();
      }
    });
  }
}