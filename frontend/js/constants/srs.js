/**
 * constants/srs.js - SRS（間隔反復）関連定数
 *
 * 評価ボタンの値、ラベル、色を一元管理する。
 * ボタン生成やレビュー送信時にこの定数を参照する。
 *
 * 依存: なし
 * 参照元: modules/study.js
 */

/** 評価値（バックエンドに送信する数値） */
export const RATING_VALUES = Object.freeze({
  AGAIN: 1,
  HARD: 2,
  GOOD: 3,
  EASY: 4,
});

/** 評価ラベル（UI表示用） */
export const RATING_LABELS = Object.freeze({
  [RATING_VALUES.AGAIN]: 'Again',
  [RATING_VALUES.HARD]: 'Hard',
  [RATING_VALUES.GOOD]: 'Good',
  [RATING_VALUES.EASY]: 'Easy',
});

/** 評価ボタンのCSSクラス名（components.cssで定義したクラスに対応） */
export const RATING_CLASSES = Object.freeze({
  [RATING_VALUES.AGAIN]: 'btn-again',
  [RATING_VALUES.HARD]: 'btn-hard',
  [RATING_VALUES.GOOD]: 'btn-good',
  [RATING_VALUES.EASY]: 'btn-easy',
});

/** 評価ボタンのDOM ID（dom.jsの STUDY_IDS と連携） */
export const RATING_BUTTON_IDS = Object.freeze({
  [RATING_VALUES.AGAIN]: 'study-btn-again',
  [RATING_VALUES.HARD]: 'study-btn-hard',
  [RATING_VALUES.GOOD]: 'study-btn-good',
  [RATING_VALUES.EASY]: 'study-btn-easy',
});

/** ノートタイプ名（SSOT: worker/api/notes.ts の NOTE_TYPES と一致させること） */
export const NOTE_TYPES = Object.freeze({
  BASIC: 'Basic',
  BASIC_REVERSED: 'Basic (and reversed card)',
  BASIC_OPTIONAL_REVERSED: 'Basic (optional reversed card)',
  BASIC_TYPE_IN_ANSWER: 'Basic (type in the answer)',
  CLOZE: 'Cloze',
  IMAGE_OCCLUSION: 'Image Occlusion',
});

/** アプリバージョン（SSOT: バージョン管理はここで一元管理） */
export const APP_VERSION = 'Ver1.0.0';
