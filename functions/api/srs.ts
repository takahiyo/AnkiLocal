/**
 * srs.ts - SM-2 スペースドリピティション アルゴリズム (TypeScript版)
 *
 * backend/srs.py からの移植。
 * 評価値に基づいて easeFactor、intervalDays、repetitions を計算し、次の復習日時を算出する。
 */

/** 復習評価値 */
export enum Rating {
  AGAIN = 1, // 不正解・やり直し
  HARD = 2,  // 難しかった
  GOOD = 3,  // 正解
  EASY = 4,  // 簡単だった
}

/** カードの学習状態 */
export interface SRSState {
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
  status: string;
}

/** SM-2計算結果 */
export interface SRSResult {
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
  nextReviewAt: Date;
  status: string;
}

// --- SRS パラメータ (SSOT) ---
const SRS_DEFAULT_EASE_FACTOR = 2.5;
const SRS_MIN_EASE_FACTOR = 1.3;
const SRS_AGAIN_INTERVAL_MINUTES = 1;
const SRS_HARD_INTERVAL_MULTIPLIER = 1.2;
const SRS_HARD_EASE_DELTA = -0.15;
const SRS_EASY_EASE_DELTA = 0.15;

/**
 * SM-2アルゴリズムに基づいて次回復習のパラメータを計算する。
 * @param state 現在のカード状態
 * @param rating ユーザーの評価値 (1-4)
 * @returns SRSResult 更新後の学習パラメータと次回復習日時
 */
export function calculateNextReview(state: SRSState, rating: Rating): SRSResult {
  const now = new Date();
  let ease = state.easeFactor ?? SRS_DEFAULT_EASE_FACTOR;
  let interval = state.intervalDays ?? 0;
  let reps = state.repetitions ?? 0;
  let status = state.status ?? "new";

  if (rating === Rating.AGAIN) {
    // Again: リセットして学習中に戻す
    reps = 0;
    // 1分後に再表示（分を日数に変換）
    interval = SRS_AGAIN_INTERVAL_MINUTES / (60 * 24);
    status = "learning";
  } else if (rating === Rating.HARD) {
    // Hard: 間隔を少し伸ばし、easeを下げる
    ease += SRS_HARD_EASE_DELTA;
    if (reps === 0) {
      interval = (1.0 / (60 * 24)) * 10; // 初回は10分後
    } else {
      interval *= SRS_HARD_INTERVAL_MULTIPLIER;
    }
    reps += 1;
    status = "review";
  } else if (rating === Rating.GOOD) {
    // Good: SM-2標準の間隔計算
    if (reps === 0) {
      interval = 1.0 / 24; // 初回: 1時間後（学習中）
      status = "learning";
    } else if (reps === 1) {
      interval = 1.0; // 2回目: 1日後
      status = "review";
    } else if (reps === 2) {
      interval = 6.0; // 3回目: 6日後
      status = "review";
    } else {
      interval *= ease;
      status = "review";
    }
    reps += 1;
  } else if (rating === Rating.EASY) {
    // Easy: 間隔を大きく伸ばし、easeを上げる
    ease += SRS_EASY_EASE_DELTA;
    if (reps === 0) {
      interval = 4.0; // 初回でも4日後
    } else {
      interval *= ease;
    }
    reps += 1;
    status = "review";
  } else {
    // 不正な評価値の場合はGood扱い
    return calculateNextReview(state, Rating.GOOD);
  }

  // 最小 ease_factor を適用
  ease = Math.max(ease, SRS_MIN_EASE_FACTOR);

  // 次回復習日時を計算
  const nextReviewAt = new Date(now.getTime() + interval * 24 * 60 * 60 * 1000);

  // 浮動小数点の丸め処理
  const round = (num: number, decimals: number) => {
    const factor = Math.pow(10, decimals);
    return Math.round(num * factor) / factor;
  };

  return {
    easeFactor: round(ease, 4),
    intervalDays: round(interval, 4),
    repetitions: reps,
    nextReviewAt,
    status,
  };
}
