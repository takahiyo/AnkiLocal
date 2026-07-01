# ============================================================
# routers/cards.py - カード関連APIルーター
# ============================================================
# 学習対象カードの取得と復習結果の登録を提供する。
# ============================================================

from datetime import datetime

from fastapi import APIRouter, HTTPException

from config import settings
from database import get_connection
from models import CardResponse, ReviewRequest, ReviewResponse
from srs import SRSState, Rating, calculate_next_review

router = APIRouter(tags=["カード"])


@router.get("/api/decks/{deck_id}/study", response_model=list[CardResponse])
async def get_study_cards(deck_id: int):
    """
    学習対象カードを取得する。

    優先順位:
    1. new (未学習カード)
    2. learning (学習中カード)
    3. review (復習期限到来カード: next_review_at <= 現在時刻)

    最大 STUDY_BATCH_SIZE 枚を返す。
    """
    db = await get_connection()
    try:
        # デッキの存在確認
        cursor = await db.execute("SELECT id FROM decks WHERE id = ?", (deck_id,))
        if not await cursor.fetchone():
            raise HTTPException(status_code=404, detail="デッキが見つかりません")

        now = datetime.utcnow().isoformat()
        batch_size = settings.STUDY_BATCH_SIZE

        # 優先順位ごとにカードを取得
        cards: list[dict] = []
        remaining = batch_size

        # 1. new カード
        if remaining > 0:
            cursor = await db.execute(
                """
                SELECT c.*, cs.ease_factor, cs.interval_days, cs.repetitions,
                       cs.status, cs.next_review_at
                FROM cards c
                JOIN card_states cs ON c.id = cs.card_id
                WHERE c.deck_id = ? AND cs.status = 'new'
                ORDER BY c.id
                LIMIT ?
                """,
                (deck_id, remaining),
            )
            rows = await cursor.fetchall()
            cards.extend(rows)
            remaining -= len(rows)

        # 2. learning カード
        if remaining > 0:
            cursor = await db.execute(
                """
                SELECT c.*, cs.ease_factor, cs.interval_days, cs.repetitions,
                       cs.status, cs.next_review_at
                FROM cards c
                JOIN card_states cs ON c.id = cs.card_id
                WHERE c.deck_id = ? AND cs.status = 'learning'
                  AND (cs.next_review_at IS NULL OR cs.next_review_at <= ?)
                ORDER BY cs.next_review_at
                LIMIT ?
                """,
                (deck_id, now, remaining),
            )
            rows = await cursor.fetchall()
            cards.extend(rows)
            remaining -= len(rows)

        # 3. review カード（復習期限到来）
        if remaining > 0:
            cursor = await db.execute(
                """
                SELECT c.*, cs.ease_factor, cs.interval_days, cs.repetitions,
                       cs.status, cs.next_review_at
                FROM cards c
                JOIN card_states cs ON c.id = cs.card_id
                WHERE c.deck_id = ? AND cs.status = 'review'
                  AND cs.next_review_at <= ?
                ORDER BY cs.next_review_at
                LIMIT ?
                """,
                (deck_id, now, remaining),
            )
            rows = await cursor.fetchall()
            cards.extend(rows)

        # レスポンス構築
        return [
            CardResponse(
                id=row["id"],
                guid=row["guid"],
                deck_id=row["deck_id"],
                note_type=row["note_type"],
                front=row["front"],
                back=row["back"],
                tags=row["tags"],
                cloze_count=row["cloze_count"],
                cloze_index=row["cloze_index"],
                is_reversed=bool(row["is_reversed"]),
                ease_factor=row["ease_factor"],
                interval_days=row["interval_days"],
                repetitions=row["repetitions"],
                status=row["status"],
                next_review_at=row["next_review_at"],
            )
            for row in cards
        ]
    finally:
        await db.close()


@router.post("/api/cards/{card_id}/review", response_model=ReviewResponse)
async def review_card(card_id: int, request: ReviewRequest):
    """
    カードの復習結果を登録し、SRSアルゴリズムで次回復習日時を計算する。
    """
    db = await get_connection()
    try:
        # カードの存在確認と現在の状態を取得
        cursor = await db.execute(
            """
            SELECT cs.ease_factor, cs.interval_days, cs.repetitions, cs.status
            FROM card_states cs
            WHERE cs.card_id = ?
            """,
            (card_id,),
        )
        state_row = await cursor.fetchone()
        if not state_row:
            raise HTTPException(status_code=404, detail="カードが見つかりません")

        # 現在の状態からSRS計算
        current_state = SRSState(
            ease_factor=state_row["ease_factor"],
            interval_days=state_row["interval_days"],
            repetitions=state_row["repetitions"],
            status=state_row["status"],
        )

        rating = Rating(request.rating)
        result = calculate_next_review(current_state, rating)

        now = datetime.utcnow().isoformat()
        next_review_str = result.next_review_at.isoformat()

        # card_states を更新
        await db.execute(
            """
            UPDATE card_states
            SET ease_factor = ?, interval_days = ?, repetitions = ?,
                next_review_at = ?, last_reviewed_at = ?, status = ?
            WHERE card_id = ?
            """,
            (
                result.ease_factor,
                result.interval_days,
                result.repetitions,
                next_review_str,
                now,
                result.status,
                card_id,
            ),
        )

        # review_logs に記録
        await db.execute(
            "INSERT INTO review_logs (card_id, rating) VALUES (?, ?)",
            (card_id, request.rating),
        )

        await db.commit()

        return ReviewResponse(
            card_id=card_id,
            rating=request.rating,
            ease_factor=result.ease_factor,
            interval_days=result.interval_days,
            repetitions=result.repetitions,
            next_review_at=next_review_str,
            status=result.status,
        )
    except ValueError:
        raise HTTPException(status_code=400, detail="不正な評価値です (1-4)")
    finally:
        await db.close()
