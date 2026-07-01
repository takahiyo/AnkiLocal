/**
 * main.js - アプリケーションのエントリーポイント
 *
 * アプリケーションの初期化、ルーティング設定、認証トークンの確認を行います。
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

import { init as initApi, setToken } from './services/api.js';
import { init as initRouter, navigate } from './modules/router.js';
import { init as initDeckList } from './modules/deck-list.js';
import { init as initStudy } from './modules/study.js';
import { init as initStats } from './modules/stats.js';
import { init as initImport } from './modules/import.js';
import { NAV_IDS } from './constants/dom.js';

document.addEventListener('DOMContentLoaded', () => {
    // 1. URLから認証トークンを抽出
    const urlParams = new URLSearchParams(window.location.search);
    let token = urlParams.get('token');

    // ローカルストレージからのフォールバックと保存
    if (token) {
        localStorage.setItem('anki_local_token', token);
    } else {
        token = localStorage.getItem('anki_local_token');
    }

    // トークンが無い場合は警告を表示して処理を止める (セキュリティ保護)
    if (!token) {
        showTokenError();
        return;
    }

    // 2. 認証トークンをAPIサービスにセット
    setToken(token);

    // 3. 各モジュール・サービスの初期化 (依存注入)
    const context = {
        // 必要に応じて共有インスタンスや設定を注入可能
        token: token
    };

    initApi(context);
    initDeckList(context);
    initStudy(context);
    initStats(context);
    initImport(context);
    
    // ルーターは最後に初期化し、初期画面に遷移
    initRouter(context);

    // ナビゲーションメニューのイベントハンドラ登録
    setupNavigation(token);
});

/**
 * トークンが見つからない場合のエラー画面表示
 */
function showTokenError() {
    const appContainer = document.getElementById('app');
    if (appContainer) {
        appContainer.innerHTML = `
            <div style="
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                background-color: #0f0f23;
                color: #e8e8f0;
                font-family: sans-serif;
                text-align: center;
                padding: 20px;
            ">
                <div style="
                    background: rgba(26, 26, 46, 0.8);
                    border: 1px solid rgba(239, 68, 68, 0.4);
                    border-radius: 12px;
                    padding: 30px;
                    max-width: 500px;
                    box-shadow: 0 8px 32px rgba(239, 68, 68, 0.1);
                    backdrop-filter: blur(10px);
                ">
                    <h1 style="color: #ef4444; margin-top: 0;">⚠️ 認証エラー</h1>
                    <p style="color: #8888a8; line-height: 1.6;">
                        アクセスに必要な認証トークンが指定されていません。
                    </p>
                    <p style="background: rgba(0,0,0,0.2); padding: 10px; border-radius: 6px; font-family: monospace; font-size: 0.9em; word-break: break-all;">
                        URLの末尾に ?token=YOUR_TOKEN を追加して再試行してください。<br>
                        (例: http://localhost:8000/?token=xxxx)
                    </p>
                    <p style="color: #8888a8; font-size: 0.85em; margin-bottom: 0;">
                        サーバーの起動コンソールに出力されたトークン値を確認してください。
                    </p>
                </div>
            </div>
        `;
    }
}

/**
 * ナビゲーションバー of クリックイベントハンドラを設定
 */
function setupNavigation(token) {
    const navDecks = document.getElementById(NAV_IDS.LINK_DECKS);
    const navStats = document.getElementById(NAV_IDS.LINK_STATS);
    const navImport = document.getElementById(NAV_IDS.LINK_IMPORT);

    if (navDecks) {
        navDecks.addEventListener('click', (e) => {
            e.preventDefault();
            navigate('#/decks');
        });
    }

    if (navStats) {
        navStats.addEventListener('click', (e) => {
            e.preventDefault();
            navigate('#/stats');
        });
    }

    if (navImport) {
        navImport.addEventListener('click', (e) => {
            e.preventDefault();
            navigate('#/import');
        });
    }
}
