/**
 * services/cloze.js - Clozeテキストレンダラー
 *
 * Anki形式のCloze削除記法 {{c1::答え}} を解析し、
 * 問題面と解答面それぞれのHTMLを生成する。
 *
 * Cloze記法: {{c<番号>::<答え>}} または {{c<番号>::<答え>::<ヒント>}}
 *
 * 依存: なし
 * 参照元: modules/study.js
 */

/**
 * Cloze記法にマッチする正規表現
 * グループ: (1)番号, (2)答えテキスト, (3)ヒント（オプション）
 */
const CLOZE_REGEX = /\{\{c(\d+)::([^:}]+)(?:::([^}]+))?\}\}/g;

/**
 * テキスト内のCloze番号の最大値を返す。
 * Clozeカードが何枚生成されるかの判定に使用する。
 * @param {string} text - Cloze記法を含むテキスト
 * @returns {number} 最大Cloze番号（Clozeが存在しない場合は0）
 */
export function getClozeCount(text) {
  if (!text) return 0;

  let maxIndex = 0;
  // replaceを利用して全マッチを走査（副作用なし、返り値は使わない）
  text.replace(CLOZE_REGEX, (_match, index) => {
    const num = parseInt(index, 10);
    if (num > maxIndex) maxIndex = num;
    return '';
  });
  return maxIndex;
}

/**
 * Cloze問題面のHTMLを生成する。
 * 対象のCloze番号を [...] プレースホルダに置換し、
 * 非対象のClozeはそのまま答えテキストで表示する。
 *
 * @param {string} text - Cloze記法を含む元テキスト
 * @param {number} targetIndex - 穴埋めにする対象のCloze番号
 * @returns {string} HTML文字列
 */
export function renderClozeQuestion(text, targetIndex) {
  if (!text) return '';

  return escapeHtml(text).replace(
    // エスケープ後のHTMLに対してマッチするため、エスケープ前に処理
    // → 元テキストに対して処理してからHTMLに変換する方が安全
    /dummy/, '' // プレースホルダ（下の実装で上書き）
  ) && text.replace(CLOZE_REGEX, (_match, index, answer, hint) => {
    const num = parseInt(index, 10);
    if (num === targetIndex) {
      // 対象: プレースホルダ表示（ヒントがあればヒントを表示）
      const displayText = hint ? hint : '[...]';
      return `<span class="cloze-placeholder">${escapeHtml(displayText)}</span>`;
    }
    // 非対象: 答えをそのまま表示
    return escapeHtml(answer);
  });
}

/**
 * Cloze解答面のHTMLを生成する。
 * 全Clozeの答えを展開し、対象のCloze番号をハイライト表示する。
 *
 * @param {string} text - Cloze記法を含む元テキスト
 * @param {number} targetIndex - ハイライトする対象のCloze番号
 * @returns {string} HTML文字列
 */
export function renderClozeAnswer(text, targetIndex) {
  if (!text) return '';

  return text.replace(CLOZE_REGEX, (_match, index, answer) => {
    const num = parseInt(index, 10);
    if (num === targetIndex) {
      // 対象: ハイライト表示
      return `<span class="cloze-revealed">${escapeHtml(answer)}</span>`;
    }
    // 非対象: 通常テキストとして表示
    return `<span class="cloze-other">${escapeHtml(answer)}</span>`;
  });
}

/**
 * HTMLエスケープ処理。
 * XSS防止のため、ユーザー入力テキストを安全にHTMLに埋め込む。
 * <br>タグと\n改行を保持する。
 * @param {string} str - エスケープ対象の文字列
 * @returns {string} エスケープ済みの文字列
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
