/**
 * main.js - アプリケーションのエントリーポイント
 *
 * アプリケーションの初期化、ルーティング設定、認証フローを行います。
 *
 * 依存:
 *   - js/services/api.js (API通信)
 *   - js/modules/router.js (ルーター)
 *   - js/modules/deck-list.js (デッキ選択)
 *   - js/modules/study.js (学習画面)
 *   - js/modules/stats.js (統計画面)
 *   - js/modules/import.js (インポート画面)
 *   - js/constants/dom.js (DOM ID定義)
 */

import { init as initApi, setToken, getToken } from './services/api.js';
import { login, register, logout } from './services/api.js';
import { init as initRouter, navigateTo, replaceRoute, onRouteChange } from './modules/router.js';
import { init as initDeckList, loadDeckList } from './modules/deck-list.js';
import { init as initStudy, startStudySession } from './modules/study.js';
import { init as initStats, loadStats } from './modules/stats.js';
import { init as initImport, resetView as resetImportView } from './modules/import.js';
import { init as initAdmin, resetView as resetAdminView } from './modules/admin.js';
import { NAV_IDS, AUTH_IDS } from './constants/dom.js';

document.addEventListener('DOMContentLoaded', () => {
    setupToast();
    setupAuth();
    setupNavigation();
    setupLogout();

    initApi({});

    initDeckList({});
    initStudy({});
    initStats({});
    initImport({});
    initAdmin({});

    onRouteChange((route, params) => {
        if (route === '/login' || route === '/register') return;
        if (!getToken()) {
            replaceRoute('/login');
            return;
        }
        if (route === '/decks') {
            loadDeckList();
        } else if (route === '/study') {
            if (params && params.deckId) {
                startStudySession(params.deckId);
            } else {
                replaceRoute('/decks');
            }
        } else if (route === '/stats') {
            loadStats();
        } else if (route === '/import') {
            resetImportView();
        } else if (route === '/admin') {
            resetAdminView();
        }
    });

    initRouter();
});

/**
 * 認証フローのセットアップ
 */
function setupAuth() {
    const LS_TOKEN = 'anki_local_token';
    const LS_IS_ADMIN = 'anki_local_is_admin';

    // 保存済みトークンがあれば復元
    const savedToken = localStorage.getItem(LS_TOKEN);
    if (savedToken) {
        setToken(savedToken);

        // 管理者状態を復元
        const savedIsAdmin = localStorage.getItem(LS_IS_ADMIN);
        if (savedIsAdmin === 'true') {
            showNavbar(true);
        } else {
            showNavbar(false);
        }
    } else {
        showNavbar(false);
    }

    // ログインフォーム
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById(AUTH_IDS.LOGIN_USERNAME).value.trim();
            const password = document.getElementById(AUTH_IDS.LOGIN_PASSWORD).value;
            const errorEl = document.getElementById(AUTH_IDS.LOGIN_ERROR);
            const submitBtn = document.getElementById(AUTH_IDS.LOGIN_SUBMIT);

            if (!username) {
                showAuthError(errorEl, 'IDを入力してください');
                return;
            }

            hideAuthError(errorEl);
            submitBtn.disabled = true;
            submitBtn.textContent = '処理中...';

            try {
                const result = await login(username, password);

                if (result.success) {
                    onLoginSuccess(result);
                } else if (result.status === 'new_account') {
                    // 新規アカウント作成画面へ
                    navigateTo(`/register/${encodeURIComponent(result.username)}`);
                }
            } catch (err) {
                showAuthError(errorEl, err.message);
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'ログイン';
            }
        });
    }

    // 登録フォーム
    const registerForm = document.getElementById('register-form');
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById(AUTH_IDS.REGISTER_USERNAME_DISPLAY).textContent;
            const password = document.getElementById(AUTH_IDS.REGISTER_PASSWORD).value;
            const passwordConfirm = document.getElementById(AUTH_IDS.REGISTER_PASSWORD_CONFIRM).value;
            const errorEl = document.getElementById(AUTH_IDS.REGISTER_ERROR);
            const submitBtn = document.getElementById(AUTH_IDS.REGISTER_SUBMIT);

            hideAuthError(errorEl);

            if (!password) {
                showAuthError(errorEl, 'パスワードを入力してください');
                return;
            }
            if (password !== passwordConfirm) {
                showAuthError(errorEl, 'パスワードが一致しません');
                return;
            }

            submitBtn.disabled = true;
            submitBtn.textContent = '作成中...';

            try {
                const result = await register(username, password);
                if (result.success) {
                    onLoginSuccess(result);
                }
            } catch (err) {
                showAuthError(errorEl, err.message);
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'アカウント作成';
            }
        });
    }

    // 登録画面の戻るボタン
    const registerBackBtn = document.getElementById(AUTH_IDS.REGISTER_BACK);
    if (registerBackBtn) {
        registerBackBtn.addEventListener('click', () => {
            navigateTo('/login');
        });
    }

    // register/:username ルートの処理
    onRouteChange((route, params) => {
        if (route === '/register' && params.username) {
            const displayEl = document.getElementById(AUTH_IDS.REGISTER_USERNAME_DISPLAY);
            if (displayEl) {
                displayEl.textContent = decodeURIComponent(params.username);
            }
            // パスワードフィールドをクリア
            document.getElementById(AUTH_IDS.REGISTER_PASSWORD).value = '';
            document.getElementById(AUTH_IDS.REGISTER_PASSWORD_CONFIRM).value = '';
            hideAuthError(document.getElementById(AUTH_IDS.REGISTER_ERROR));
        }
        if (route === '/login') {
            hideAuthError(document.getElementById(AUTH_IDS.LOGIN_ERROR));
        }
    });
}

function onLoginSuccess(result) {
    const LS_TOKEN = 'anki_local_token';
    const LS_IS_ADMIN = 'anki_local_is_admin';

    localStorage.setItem(LS_TOKEN, result.token);
    setToken(result.token);

    if (result.is_admin) {
        localStorage.setItem(LS_IS_ADMIN, 'true');
        showNavbar(true);
    } else {
        localStorage.setItem(LS_IS_ADMIN, 'false');
        showNavbar(false);
    }

    // メイン画面へ
    replaceRoute('/decks');
}

function showNavbar(isAdmin) {
    const navbar = document.getElementById('app-navbar');
    if (navbar) navbar.style.display = 'flex';

    const importLink = document.getElementById(NAV_IDS.LINK_IMPORT);
    if (importLink) {
        importLink.style.display = isAdmin ? '' : 'none';
    }

    const adminLink = document.getElementById(NAV_IDS.LINK_ADMIN);
    if (adminLink) {
        adminLink.style.display = isAdmin ? '' : 'none';
    }
}

function setupLogout() {
    const logoutBtn = document.getElementById(NAV_IDS.LINK_LOGOUT);
    if (!logoutBtn) return;

    logoutBtn.addEventListener('click', async () => {
        const LS_TOKEN = 'anki_local_token';
        const LS_IS_ADMIN = 'anki_local_is_admin';

        try {
            await logout();
        } catch (e) {
            // ログアウト失敗時もローカルはクリア
        }

        localStorage.removeItem(LS_TOKEN);
        localStorage.removeItem(LS_IS_ADMIN);
        setToken('');
        replaceRoute('/login');
    });
}

function showAuthError(el, message) {
    if (!el) return;
    el.textContent = message;
    el.classList.remove('hidden');
}

function hideAuthError(el) {
    if (!el) return;
    el.classList.add('hidden');
    el.textContent = '';
}

/**
 * トースト通知システム（window._showToast）をセットアップする
 */
function setupToast() {
    window._showToast = (message, type = 'info') => {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast toast-${type} animate-fade-in`;
        toast.textContent = message;

        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('animate-fade-out');
            toast.addEventListener('animationend', () => {
                toast.remove();
            });
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.remove();
                }
            }, 500);
        }, 3000);
    };
}

/**
 * ナビゲーションバーのクリックイベントハンドラを設定
 */
function setupNavigation() {
    const navDecks = document.getElementById(NAV_IDS.LINK_DECKS);
    const navStats = document.getElementById(NAV_IDS.LINK_STATS);
    const navImport = document.getElementById(NAV_IDS.LINK_IMPORT);

    if (navDecks) {
        navDecks.addEventListener('click', (e) => {
            e.preventDefault();
            navigateTo('/decks');
        });
    }

    if (navStats) {
        navStats.addEventListener('click', (e) => {
            e.preventDefault();
            navigateTo('/stats');
        });
    }

    if (navImport) {
        navImport.addEventListener('click', (e) => {
            e.preventDefault();
            navigateTo('/import');
        });
    }

    const navAdmin = document.getElementById(NAV_IDS.LINK_ADMIN);
    if (navAdmin) {
        navAdmin.addEventListener('click', (e) => {
            e.preventDefault();
            navigateTo('/admin');
        });
    }
}