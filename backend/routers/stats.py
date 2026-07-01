# ============================================================
# routers/stats.py - 統計情報APIルーター
# ============================================================
# 全体統計とデッキ別統計のエンドポイントを提供する。
# ============================================================

from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException

from database import get_connection
from models import StatsResponse

router = APIRouter(tags=["統計"])


async def _get_stats(db, deck_id: int = None) -> StatsResponse:
    """
    統計情報を取得する共通関数。

    deck_id が指定されていればデッキ単位、
    Noneなら全体の統計を返す。
    """
    # WHERE句の構築
    card_where = "WHERE c.deck_id = ?" if deck_id else ""
    card_params = (deck_id,) if deck_id else ()

    # カード数の集計
    cursor = await db.execute(
        f"""
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN cs.status = 'new' OR cs.status IS NULL THEN 1 ELSE 0 END) as new_count,
            SUM(CASE WHEN cs.status = 'learning' THEN 1 ELSE 0 END) as learning_count,
            SUM(CASE WHEN cs.status = 'review' THEN 1 ELSE 0 END) as review_count
        FROM cards c
        LEFT JOIN card_states cs ON c.id = cs.card_id
        {card_where}
        """,
        card_params,
    )
    counts = await cursor.fetchone()

    # 復習ログの集計
    review_where = ""
    review_params: tuple = ()
    if deck_id:
        review_where = "WHERE rl.card_id IN (SELECT id FROM cards WHERE deck_id = ?)"
        review_params = (deck_id,)

    cursor = await db.execute(
        f"SELECT COUNT(*) as total FROM review_logs rl {review_where}",
        review_params,
    )
    total_reviews_row = await cursor.fetchone()

    # 今日の復習数（UTC基準）
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    if deck_id:
        today_where = (
            "WHERE rl.reviewed_at >= ? "
            "AND rl.card_id IN (SELECT id FROM cards WHERE deck_id = ?)"
        )
        today_params = (today_start, deck_id)
    else:
        today_where = "WHERE rl.reviewed_at >= ?"
        today_params = (today_start,)

    cursor = await db.execute(
        f"SELECT COUNT(*) as today FROM review_logs rl {today_where}",
        today_params,
    )
    today_row = await cursor.fetchone()

    # デッキ名の取得（デッキ別統計の場合）
    deck_name = None
    if deck_id:
        cursor = await db.execute("SELECT name FROM decks WHERE id = ?", (deck_id,))
        deck_row = await cursor.fetchone()
        if deck_row:
            deck_name = deck_row["name"]

    return StatsResponse(
        total_cards=counts["total"] or 0,
        new_cards=counts["new_count"] or 0,
        learning_cards=counts["learning_count"] or 0,
        review_cards=counts["review_count"] or 0,
        total_reviews=total_reviews_row["total"] or 0,
        reviews_today=today_row["today"] or 0,
        deck_id=deck_id,
        deck_name=deck_name,
    )


@router.get("/api/stats", response_model=StatsResponse)
async def get_overall_stats():
    """全体統計を取得する"""
    db = await get_connection()
    try:
        return await _get_stats(db)
    finally:
        await db.close()


@router.get("/api/stats/deck/{deck_id}", response_model=StatsResponse)
async def get_deck_stats(deck_id: int):
    """デッキ別統計を取得する"""
    db = await get_connection()
    try:
        # デッキの存在確認
        cursor = await db.execute("SELECT id FROM decks WHERE id = ?", (deck_id,))
        if not await cursor.fetchone():
            raise HTTPException(status_code=404, detail="デッキが見つかりません")

        return await _get_stats(db, deck_id)
    finally:
        await db.close()
