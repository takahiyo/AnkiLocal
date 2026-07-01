# ============================================================
# srs.py - SM-2 スペースドリピティション アルゴリズム
# ============================================================
# SM-2ベースの間隔反復アルゴリズムを実装する。
# 評価値に基づいてease_factor、interval、repetitionsを計算し、
# 次回復習日時を決定する。
# ============================================================

from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import IntEnum

from config import settings


class Rating(IntEnum):
    """復習評価値"""
    AGAIN = 1  # 不正解・やり直し
    HARD = 2   # 難しかった
    GOOD = 3   # 正解
    EASY = 4   # 簡単だった


@dataclass
class SRSState:
    """カードの学習状態"""
    ease_factor: float = settings.SRS_DEFAULT_EASE_FACTOR
    interval_days: float = 0.0
    repetitions: int = 0
    status: str = "new"


@dataclass
class SRSResult:
    """SM-2計算結果"""
    ease_factor: float
    interval_days: float
    repetitions: int
    next_review_at: datetime
    status: str


def calculate_next_review(state: SRSState, rating: Rating) -> SRSResult:
    """
    SM-2アルゴリズムに基づいて次回復習のパラメータを計算する。

    Args:
        state: 現在のカード状態
        rating: ユーザーの評価値 (1-4)

    Returns:
        SRSResult: 更新後の学習パラメータと次回復習日時
    """
    now = datetime.utcnow()
    ease = state.ease_factor
    interval = state.interval_days
    reps = state.repetitions

    if rating == Rating.AGAIN:
        # Again: リセットして学習中に戻す
        reps = 0
        # 1分後に再表示（分を日数に変換）
        interval = settings.SRS_AGAIN_INTERVAL_MINUTES / (60 * 24)
        status = "learning"

    elif rating == Rating.HARD:
        # Hard: 間隔を少し伸ばし、easeを下げる
        ease += settings.SRS_HARD_EASE_DELTA
        if reps == 0:
            interval = 1.0 / (60 * 24) * 10  # 初回は10分後
        else:
            interval *= settings.SRS_HARD_INTERVAL_MULTIPLIER
        reps += 1
        status = "review"

    elif rating == Rating.GOOD:
        # Good: SM-2標準の間隔計算
        if reps == 0:
            interval = 1.0 / 24  # 初回: 1時間後（学習中）
            status = "learning"
        elif reps == 1:
            interval = 1.0  # 2回目: 1日後
            status = "review"
        elif reps == 2:
            interval = 6.0  # 3回目: 6日後
            status = "review"
        else:
            interval *= ease
            status = "review"
        reps += 1

    elif rating == Rating.EASY:
        # Easy: 間隔を大きく伸ばし、easeを上げる
        ease += settings.SRS_EASY_EASE_DELTA
        if reps == 0:
            interval = 4.0  # 初回でも4日後
        else:
            interval *= ease
        reps += 1
        status = "review"

    else:
        # 不正な評価値の場合はGood扱い
        return calculate_next_review(state, Rating.GOOD)

    # 最小ease_factorを適用
    ease = max(ease, settings.SRS_MIN_EASE_FACTOR)

    # 次回復習日時を計算
    next_review_at = now + timedelta(days=interval)

    return SRSResult(
        ease_factor=round(ease, 4),
        interval_days=round(interval, 4),
        repetitions=reps,
        next_review_at=next_review_at,
        status=status,
    )
