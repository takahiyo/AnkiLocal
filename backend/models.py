# ============================================================
# models.py - Pydanticモデル定義
# ============================================================
# APIのリクエスト・レスポンスで使用するデータモデルを定義する。
# ============================================================

from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


# --- デッキ関連 ---

class DeckCardCounts(BaseModel):
    """デッキ内のカード数内訳"""
    total: int = 0
    new: int = 0
    learning: int = 0
    review: int = 0


class DeckResponse(BaseModel):
    """デッキ情報レスポンス"""
    id: int
    name: str
    created_at: str
    card_counts: DeckCardCounts


# --- カード関連 ---

class CardResponse(BaseModel):
    """カード情報レスポンス"""
    id: int
    guid: str
    deck_id: int
    note_type: str
    front: str
    back: str
    tags: str
    cloze_count: int = 0
    cloze_index: int = 0
    is_reversed: bool = False
    # 学習状態
    ease_factor: float = 2.5
    interval_days: float = 0.0
    repetitions: int = 0
    status: str = "new"
    next_review_at: Optional[str] = None


# --- 復習関連 ---

class ReviewRequest(BaseModel):
    """復習結果リクエスト"""
    rating: int = Field(..., ge=1, le=4, description="評価値: 1=Again, 2=Hard, 3=Good, 4=Easy")


class ReviewResponse(BaseModel):
    """復習結果レスポンス"""
    card_id: int
    rating: int
    ease_factor: float
    interval_days: float
    repetitions: int
    next_review_at: str
    status: str


# --- 統計関連 ---

class StatsResponse(BaseModel):
    """統計情報レスポンス"""
    total_cards: int = 0
    new_cards: int = 0
    learning_cards: int = 0
    review_cards: int = 0
    total_reviews: int = 0
    reviews_today: int = 0
    deck_id: Optional[int] = None
    deck_name: Optional[str] = None


# --- インポート関連 ---

class ImportResponse(BaseModel):
    """インポート結果レスポンス"""
    success: bool
    message: str
    total_notes_parsed: int = 0
    total_cards_created: int = 0
    decks_created: list[str] = []
    skipped_existing: int = 0
