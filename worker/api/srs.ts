/**
 * srs.ts - SM-2 スペースドリピティション アルゴリズム (TypeScript版)
 *
 * 評価値に基づいて easeFactor、intervalDays、repetitions、lapses を計算し、
 * 次の復習日時を算出する。
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
  lapses: number;
  status: string;
}

/** SM-2計算結果 */
export interface SRSResult {
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
  lapses: number;
  nextReviewAt: Date;
  status: string;
}

// --- SRS パラメータ (SSOT) ---
const SRS_DEFAULT_EASE_FACTOR = 2.5;
const SRS_MIN_EASE_FACTOR = 1.3;

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
  let lapses = state.lapses ?? 0;
  let status = state.status ?? "new";

  // 新規・再学習カード
  if (interval === 0) {
    if (rating === Rating.AGAIN || rating === Rating.HARD) {
      interval = 0; // 今日中に再出題
      if (rating === Rating.AGAIN) lapses += 1;
      status = "learning";
      reps = 0;
    } else if (rating === Rating.GOOD) {
      interval = 1;
      status = "review";
      reps += 1;
    } else if (rating === Rating.EASY) {
      interval = 4;
      status = "review";
      reps += 1;
    }
  } else {
    // 復習カード
    if (rating === Rating.AGAIN) {
      interval = 0;
      ease = Math.max(SRS_MIN_EASE_FACTOR, ease - 0.2);
      lapses += 1;
      status = "learning";
      reps = 0; // Againの場合はrepsをリセットする（SM-2の一般的仕様）
    } else if (rating === Rating.HARD) {
      interval = Math.max(interval + 1, interval * 1.2);
      ease = Math.max(SRS_MIN_EASE_FACTOR, ease - 0.15);
      status = "review";
      reps += 1;
    } else if (rating === Rating.GOOD) {
      interval = interval * ease;
      status = "review";
      reps += 1;
    } else if (rating === Rating.EASY) {
      interval = interval * ease * 1.3;
      ease += 0.15;
      status = "review";
      reps += 1;
    }
  }

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
    lapses,
    nextReviewAt,
    status,
  };
}

/**
 * ドライラン: 各評価値を選択した場合の次回予定時間(文字列)を返す
 * @param state 現在のカード状態
 * @returns 各ボタン用のラベル
 */
export function previewNextIntervals(state: SRSState): { again: string, hard: string, good: string, easy: string } {
  const formatInterval = (days: number) => {
    if (days === 0) return "< 1m";
    if (days < 1) return `${Math.round(days * 24)}h`;
    if (days < 30) return `${Math.round(days)}d`;
    if (days < 365) return `${Math.round(days / 30)}mo`;
    return `${(days / 365).toFixed(1)}y`;
  };

  const resAgain = calculateNextReview(state, Rating.AGAIN);
  const resHard = calculateNextReview(state, Rating.HARD);
  const resGood = calculateNextReview(state, Rating.GOOD);
  const resEasy = calculateNextReview(state, Rating.EASY);

  return {
    again: formatInterval(resAgain.intervalDays),
    hard: formatInterval(resHard.intervalDays),
    good: formatInterval(resGood.intervalDays),
    easy: formatInterval(resEasy.intervalDays),
  };
}
