/**
 * modules/router.js - ハッシュベースSPAルーター
 *
 * URLハッシュ（#/decks, #/study/:deckId, #/stats, #/import）に基づいて
 * ページセクションの表示を切り替える。
 * フェードインアニメーション付きのページ遷移を提供する。
 *
 * 依存: constants/dom.js (PAGE_IDS, NAV_IDS)
 * 参照元: main.js から init() で起動
 */

import { PAGE_IDS, NAV_IDS } from '../constants/index.js';

/** ルート定義: ハッシュパターン → ページID のマッピング */
const ROUTES = Object.freeze({
  '/login': PAGE_IDS.LOGIN,
  '/register': PAGE_IDS.REGISTER,
  '/decks': PAGE_IDS.DECK_LIST,
  '/study': PAGE_IDS.STUDY,
  '/stats': PAGE_IDS.STATS,
  '/import': PAGE_IDS.IMPORT,
  '/admin': PAGE_IDS.ADMIN,
});

/** ナビリンクとルートの対応 */
const NAV_ROUTE_MAP = Object.freeze({
  [NAV_IDS.LINK_DECKS]: '/decks',
  [NAV_IDS.LINK_STATS]: '/stats',
  [NAV_IDS.LINK_IMPORT]: '/import',
  [NAV_IDS.LINK_ADMIN]: '/admin',
});

/** ルート変更時のコールバック関数群 */
let _onRouteChangeCallbacks = [];

/** 履歴のスタック追跡用 */
let _historyCount = 0;

/**
 * 現在のハッシュからルート情報を解析する。
 * @returns {{ route: string, params: object }} ルートパスとパラメータ
 */
export function parseCurrentRoute() {
  const hash = window.location.hash.slice(1) || '/login';
  const parts = hash.split('/').filter(Boolean);

  // /study/:deckId
  if (parts[0] === 'study' && parts[1]) {
    return {
      route: '/study',
      params: { deckId: parts[1] },
    };
  }

  // /register/:username
  if (parts[0] === 'register' && parts[1]) {
    return {
      route: '/register',
      params: { username: parts[1] },
    };
  }

  const route = `/${parts[0] || 'login'}`;
  if (ROUTES[route]) {
    return { route, params: {} };
  }

  return { route: '/login', params: {} };
}

/**
 * 指定ルートに対応するページセクションを表示し、他を非表示にする。
 * @param {string} route - ルートパス
 */
function activatePage(route) {
  const targetPageId = ROUTES[route];
  if (!targetPageId) {
    replaceRoute('/login');
    return;
  }

  // 全ページセクションを非表示にし、対象のみ表示
  Object.values(PAGE_IDS).forEach((pageId) => {
    const el = document.getElementById(pageId);
    if (!el) return;

    if (pageId === targetPageId) {
      el.classList.add('active');
      el.classList.add('page-transition');
    } else {
      el.classList.remove('active');
      el.classList.remove('page-transition');
    }
  });

  // ナビリンクのアクティブ状態を更新
  Object.entries(NAV_ROUTE_MAP).forEach(([navId, navRoute]) => {
    const el = document.getElementById(navId);
    if (!el) return;
    el.classList.toggle('active', navRoute === route);
  });
}

/**
 * ルート変更時に呼び出されるコールバックを登録する。
 * @param {function} callback - (route, params) => void
 */
export function onRouteChange(callback) {
  _onRouteChangeCallbacks.push(callback);
}

/**
 * 指定ルートに遷移する。履歴スタックが積まれる。
 * @param {string} path - ルートパス（例: '/study/123'）
 */
export function navigateTo(path) {
  window.location.hash = path;
}

/**
 * 履歴スタックを積まずに現在のルートを置換する。
 * @param {string} path - ルートパス（例: '/decks'）
 */
export function replaceRoute(path) {
  const url = new URL(window.location);
  url.hash = path;
  window.history.replaceState(null, '', url);
  handleHashChange();
}

/**
 * 前のページに戻る。
 * @param {string} fallbackPath - フォールバック先ルート
 */
export function goBack(fallbackPath = '/decks') {
  if (_historyCount > 0) {
    window.history.back();
  } else {
    replaceRoute(fallbackPath);
  }
}

/**
 * ハッシュ変更イベントのハンドラ。
 */
function handleHashChange() {
  const { route, params } = parseCurrentRoute();
  activatePage(route);

  _onRouteChangeCallbacks.forEach((cb) => {
    try {
      cb(route, params);
    } catch (err) {
      console.error('[Router] ルート変更コールバックでエラー:', err);
    }
  });
}

/**
 * ルーターを初期化する。
 */
export function init() {
  window.addEventListener('hashchange', () => {
    _historyCount++;
    handleHashChange();
  });

  if (!window.location.hash) {
    window.location.hash = '#/login';
  } else {
    handleHashChange();
  }
}