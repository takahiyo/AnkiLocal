/**
 * modules/stats.js - 統計画面
 *
 * 全体統計サマリーカード（総カード数、新規、学習中、復習待ち、習得済み）と
 * デッキ別テーブル、円グラフ的な可視化（SVGで実装）を表示する。
 *
 * 依存: constants/dom.js, services/api.js
 * 参照元: main.js から init() で起動
 */

import { STATS_IDS } from '../constants/index.js';
import { fetchStats } from '../services/api.js';

/**
 * トースト通知
 */
function showToast(message, type = 'error') {
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
 * 統計データを読み込んで画面を描画する。
 */
export async function loadStats() {
  const loading = $(STATS_IDS.LOADING);
  const container = $('stats-container'); // Need to map this correctly, but string 'stats-container' works since index.html uses it.

  if (loading) loading.style.display = 'flex';
  if (container) container.style.display = 'none';

  try {
    const stats = await fetchStats();
    renderSummary(stats);
    renderChart(stats);
    renderDeckTable(stats);
  } catch (err) {
    showToast(`統計の取得に失敗しました: ${err.message}`, 'error');
  } finally {
    if (loading) loading.style.display = 'none';
    if (container) container.style.display = 'block';
  }
}

/**
 * サマリーカード群を描画する。
 * @param {object} stats - 統計データ
 */
function renderSummary(stats) {
  const grid = $(STATS_IDS.SUMMARY_GRID);
  if (!grid) return;

  const items = [
    { id: STATS_IDS.TOTAL_CARDS, value: stats.total_cards || 0, label: '総カード数', icon: '📦' },
    { id: STATS_IDS.NEW_COUNT, value: stats.new_count || 0, label: '新規', icon: '🆕' },
    { id: STATS_IDS.LEARNING_COUNT, value: stats.learning_count || 0, label: '学習中', icon: '📖' },
    { id: STATS_IDS.REVIEW_COUNT, value: stats.review_count || 0, label: '復習待ち', icon: '🔄' },
    { id: STATS_IDS.MASTERED_COUNT, value: stats.mastered_count || 0, label: '習得済み', icon: '✅' },
  ];

  grid.innerHTML = items.map((item) => `
    <div class="stat-card" id="${item.id}">
      <div style="font-size: 1.5rem; margin-bottom: var(--spacing-xs);">${item.icon}</div>
      <div class="stat-value">${item.value.toLocaleString()}</div>
      <div class="stat-label">${item.label}</div>
    </div>
  `).join('');

  grid.classList.add('stagger-in');
}

/**
 * 円グラフ（SVGドーナツチャート）を描画する。
 * 外部ライブラリ不要で、CSSストロークとSVGで実装。
 * @param {object} stats - 統計データ
 */
function renderChart(stats) {
  const container = $(STATS_IDS.CHART_CONTAINER);
  if (!container) return;

  const total = stats.total_cards || 0;
  if (total === 0) {
    container.innerHTML = '<p style="text-align:center; color: var(--text-muted);">データがありません</p>';
    return;
  }

  const segments = [
    { label: '新規', value: stats.new_count || 0, color: '#3b82f6' },
    { label: '学習中', value: stats.learning_count || 0, color: '#f59e0b' },
    { label: '復習待ち', value: stats.review_count || 0, color: '#10b981' },
    { label: '習得済み', value: stats.mastered_count || 0, color: '#7c3aed' },
  ];

  // SVGドーナツチャートのパラメータ
  const size = 200;
  const strokeWidth = 30;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const centerX = size / 2;
  const centerY = size / 2;

  let cumulativePercent = 0;
  const paths = segments
    .filter((s) => s.value > 0)
    .map((segment) => {
      const percent = segment.value / total;
      const offset = circumference * (1 - percent);
      const rotation = cumulativePercent * 360;
      cumulativePercent += percent;

      return `
        <circle
          cx="${centerX}" cy="${centerY}" r="${radius}"
          fill="none"
          stroke="${segment.color}"
          stroke-width="${strokeWidth}"
          stroke-dasharray="${circumference}"
          stroke-dashoffset="${offset}"
          transform="rotate(${rotation - 90} ${centerX} ${centerY})"
          stroke-linecap="round"
          style="transition: stroke-dashoffset 0.8s ease;"
        />
      `;
    })
    .join('');

  // 凡例
  const legend = segments.map((s) => `
    <div style="display: flex; align-items: center; gap: var(--spacing-sm);">
      <span style="width: 12px; height: 12px; border-radius: 50%; background: ${s.color}; flex-shrink: 0;"></span>
      <span style="color: var(--text-secondary); font-size: var(--font-size-sm);">${s.label}</span>
      <span style="color: var(--text-primary); font-weight: var(--font-weight-semibold); margin-left: auto;">${s.value}</span>
    </div>
  `).join('');

  container.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: center; gap: var(--spacing-2xl); flex-wrap: wrap;">
      <div style="position: relative; width: ${size}px; height: ${size}px;">
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
          <!-- 背景リング -->
          <circle cx="${centerX}" cy="${centerY}" r="${radius}" fill="none"
                  stroke="rgba(255,255,255,0.05)" stroke-width="${strokeWidth}" />
          ${paths}
        </svg>
        <!-- 中央テキスト -->
        <div style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;">
          <div style="font-size: var(--font-size-2xl); font-weight: var(--font-weight-bold); color: var(--text-primary);">${total}</div>
          <div style="font-size: var(--font-size-xs); color: var(--text-muted);">合計</div>
        </div>
      </div>
      <div style="display: flex; flex-direction: column; gap: var(--spacing-sm); min-width: 150px;">
        ${legend}
      </div>
    </div>
  `;
}

/**
 * デッキ別統計テーブルを描画する。
 * @param {object} stats - 統計データ（decks配列を含む）
 */
function renderDeckTable(stats) {
  const table = $(STATS_IDS.DECK_TABLE);
  if (!table) return;

  const decks = stats.decks || [];
  if (decks.length === 0) {
    table.innerHTML = '<p style="text-align:center; color: var(--text-muted);">デッキがありません</p>';
    return;
  }

  table.innerHTML = `
    <div style="overflow-x: auto;">
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="border-bottom: 1px solid var(--border-glass);">
            <th style="text-align: left; padding: var(--spacing-sm) var(--spacing-md); color: var(--text-secondary); font-size: var(--font-size-sm); font-weight: var(--font-weight-medium);">デッキ名</th>
            <th style="text-align: center; padding: var(--spacing-sm) var(--spacing-md); color: var(--text-secondary); font-size: var(--font-size-sm); font-weight: var(--font-weight-medium);">合計</th>
            <th style="text-align: center; padding: var(--spacing-sm) var(--spacing-md); color: var(--text-secondary); font-size: var(--font-size-sm); font-weight: var(--font-weight-medium);">新規</th>
            <th style="text-align: center; padding: var(--spacing-sm) var(--spacing-md); color: var(--text-secondary); font-size: var(--font-size-sm); font-weight: var(--font-weight-medium);">学習中</th>
            <th style="text-align: center; padding: var(--spacing-sm) var(--spacing-md); color: var(--text-secondary); font-size: var(--font-size-sm); font-weight: var(--font-weight-medium);">復習</th>
          </tr>
        </thead>
        <tbody>
          ${decks.map((d) => `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.03);">
              <td style="padding: var(--spacing-sm) var(--spacing-md); color: var(--text-primary);">${escapeHtml(d.name || '')}</td>
              <td style="text-align: center; padding: var(--spacing-sm) var(--spacing-md); color: var(--text-primary);">${d.card_count || 0}</td>
              <td style="text-align: center; padding: var(--spacing-sm) var(--spacing-md);"><span class="badge badge-new">${d.new_count || 0}</span></td>
              <td style="text-align: center; padding: var(--spacing-sm) var(--spacing-md);"><span class="badge badge-learning">${d.learning_count || 0}</span></td>
              <td style="text-align: center; padding: var(--spacing-sm) var(--spacing-md);"><span class="badge badge-review">${d.review_count || 0}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
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
 * 統計モジュールを初期化する。
 */
export function init() {
  // ルーター経由でloadStats()が呼ばれるため、ここでは何もしない
}
