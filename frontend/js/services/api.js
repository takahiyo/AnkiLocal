/**
 * services/api.js - API通信サービス
 *
 * バックエンドとの全通信を一元管理するfetchラッパー。
 * URLのトークンパラメータ付与、エラーハンドリング、レスポンス解析を担当する。
 *
 * 依存: constants/api.js
 * 参照元: modules/deck-list.js, modules/study.js, modules/stats.js, modules/import.js
 */

import { API } from '../constants/index.js';

/** モジュール内で保持する認証トークン */
let _token = '';

/**
 * 認証トークンをAPIサービスにセットする。
 * @param {string} token - トークン文字列
 */
export function setToken(token) {
  _token = token;
}

/**
 * APIサービスを初期化する。
 * @param {object} context - 初期化コンテキスト
 */
export function init(context) {
  if (context && context.token) {
    _token = context.token;
  }
}

/**
 * URLのクエリパラメータからトークンを取得する。
 * ?token=xxx の形式で渡される認証トークンを抽出する。
 * @returns {string} トークン文字列（存在しない場合は空文字）
 */
function getToken() {
  const params = new URLSearchParams(window.location.search);
  return params.get('token') || '';
}

/**
 * エンドポイントURLにトークンをクエリパラメータとして付与する。
 * @param {string} endpoint - APIパス（例: '/api/decks'）
 * @returns {string} トークン付きURL
 */
function buildUrl(endpoint) {
  const token = _token || getToken();
  const separator = endpoint.includes('?') ? '&' : '?';
  return token ? `${endpoint}${separator}token=${encodeURIComponent(token)}` : endpoint;
}

/**
 * APIエラーレスポンスのハンドリング。
 * ステータスコードに応じたエラーメッセージを生成する。
 * @param {Response} response - fetchのレスポンスオブジェクト
 * @throws {Error} HTTPエラーの詳細を含むErrorオブジェクト
 */
async function handleErrorResponse(response) {
  let errorMessage = `HTTP ${response.status}`;
  try {
    const errorBody = await response.json();
    errorMessage = errorBody?.error || errorBody?.message || errorMessage;
  } catch {
    // JSONパースできない場合はステータスコードのみ
  }
  throw new Error(errorMessage);
}

/**
 * GETリクエストを送信する。
 * @param {string} endpoint - APIエンドポイント
 * @returns {Promise<any>} レスポンスのJSONデータ
 */
export async function apiGet(endpoint) {
  const url = buildUrl(endpoint);
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
  });

  if (!response.ok) {
    await handleErrorResponse(response);
  }

  return response.json();
}

/**
 * POSTリクエスト（JSON body）を送信する。
 * @param {string} endpoint - APIエンドポイント
 * @param {object} body - リクエストボディ
 * @returns {Promise<any>} レスポンスのJSONデータ
 */
export async function apiPost(endpoint, body) {
  const url = buildUrl(endpoint);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    await handleErrorResponse(response);
  }

  return response.json();
}

/**
 * POSTリクエスト（FormData）を送信する。
 * ファイルアップロード等に使用する。Content-Typeはブラウザが自動設定するため指定しない。
 * @param {string} endpoint - APIエンドポイント
 * @param {FormData} formData - FormDataオブジェクト
 * @returns {Promise<any>} レスポンスのJSONデータ
 */
export async function apiPostFormData(endpoint, formData) {
  const url = buildUrl(endpoint);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Accept': 'application/json' },
    body: formData,
  });

  if (!response.ok) {
    await handleErrorResponse(response);
  }

  return response.json();
}

/* === 便利なショートカット関数群 === */

/** デッキ一覧を取得 */
export const fetchDecks = () => apiGet(API.DECKS);

/** 指定デッキの学習カードを取得 */
export const fetchStudyCards = (deckId) => apiGet(API.STUDY(deckId));

/** カードレビューを送信 */
export const submitReview = (cardId, rating) => apiPost(API.REVIEW(cardId), { rating });

/** 全体統計を取得 */
export const fetchStats = () => apiGet(API.STATS);

/** デッキ別統計を取得 */
export const fetchDeckStats = (deckId) => apiGet(API.DECK_STATS(deckId));

/** ファイルをインポート */
export const importFile = (file) => {
  const formData = new FormData();
  formData.append('file', file);
  return apiPostFormData(API.IMPORT, formData);
};
