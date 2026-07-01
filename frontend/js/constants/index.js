/**
 * constants/index.js - バレルファイル
 *
 * constants/ 配下の全定数モジュールを一括エクスポートする。
 * 使用側は `import { API, PAGE_IDS, ... } from './constants/index.js'` で統一的にアクセスできる。
 *
 * 依存: constants/*.js
 * 参照元: services/*.js, modules/*.js, main.js
 */

export { API } from './api.js';

export {
  PAGE_IDS,
  NAV_IDS,
  DECK_LIST_IDS,
  STUDY_IDS,
  STATS_IDS,
  IMPORT_IDS,
  TOAST_IDS,
  FOOTER_IDS,
} from './dom.js';

export {
  RATING_VALUES,
  RATING_LABELS,
  RATING_CLASSES,
  RATING_BUTTON_IDS,
  NOTE_TYPES,
  APP_VERSION,
} from './srs.js';
