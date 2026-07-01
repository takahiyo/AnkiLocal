# ============================================================
# routers/decks.py - デッキ関連APIルーター
# ============================================================
# デッキ一覧取得とファイルインポートのエンドポイントを提供する。
# ============================================================

from fastapi import APIRouter, UploadFile, File, HTTPException
from models import DeckResponse, DeckCardCounts, ImportResponse
from database import get_connection
from parser import parse_anki_file

router = APIRouter(tags=["デッキ"])


@router.get("/api/decks", response_model=list[DeckResponse])
async def get_decks():
    """
    デッキ一覧を取得する。
    各デッキのカード数と new/learning/review の内訳を含む。
    """
    db = await get_connection()
    try:
        # 全デッキを取得
        cursor = await db.execute("SELECT id, name, created_at FROM decks ORDER BY name")
        decks = await cursor.fetchall()

        result = []
        for deck in decks:
            deck_id = deck["id"]

            # カード数の内訳を集計
            count_cursor = await db.execute(
                """
                SELECT
                    COUNT(*) as total,
                    SUM(CASE WHEN cs.status = 'new' OR cs.status IS NULL THEN 1 ELSE 0 END) as new_count,
                    SUM(CASE WHEN cs.status = 'learning' THEN 1 ELSE 0 END) as learning_count,
                    SUM(CASE WHEN cs.status = 'review' THEN 1 ELSE 0 END) as review_count
                FROM cards c
                LEFT JOIN card_states cs ON c.id = cs.card_id
                WHERE c.deck_id = ?
                """,
                (deck_id,),
            )
            counts = await count_cursor.fetchone()

            result.append(DeckResponse(
                id=deck_id,
                name=deck["name"],
                created_at=deck["created_at"],
                card_counts=DeckCardCounts(
                    total=counts["total"] or 0,
                    new=counts["new_count"] or 0,
                    learning=counts["learning_count"] or 0,
                    review=counts["review_count"] or 0,
                ),
            ))

        return result
    finally:
        await db.close()


@router.post("/api/import", response_model=ImportResponse)
async def import_file(file: UploadFile = File(...)):
    """
    Ankiエクスポートファイルをインポートする。

    - タブ区切りテキストファイルを解析
    - デッキが存在しない場合は自動作成
    - 重複カード（同一GUID+cloze_index+is_reversed）はスキップ
    """
    # ファイル内容を読み込み
    try:
        raw = await file.read()
        # UTF-8でデコード（BOM対応）
        content = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="ファイルのエンコーディングがUTF-8ではありません")

    # パーサーでカードを展開
    parsed_cards = parse_anki_file(content)
    if not parsed_cards:
        return ImportResponse(
            success=False,
            message="カードが見つかりませんでした。ファイル形式を確認してください。",
        )

    db = await get_connection()
    try:
        # ユニークなノート数をカウント（GUID単位）
        unique_notes = set()
        decks_created = []
        cards_created = 0
        skipped = 0

        # デッキ名 → IDのキャッシュ
        deck_cache: dict[str, int] = {}

        for card in parsed_cards:
            unique_notes.add(card.guid)

            # デッキを取得または作成
            if card.deck_name not in deck_cache:
                cursor = await db.execute(
                    "SELECT id FROM decks WHERE name = ?", (card.deck_name,)
                )
                row = await cursor.fetchone()
                if row:
                    deck_cache[card.deck_name] = row["id"]
                else:
                    cursor = await db.execute(
                        "INSERT INTO decks (name) VALUES (?)", (card.deck_name,)
                    )
                    deck_cache[card.deck_name] = cursor.lastrowid
                    decks_created.append(card.deck_name)

            deck_id = deck_cache[card.deck_name]

            # カードを挿入（重複はスキップ）
            try:
                cursor = await db.execute(
                    """
                    INSERT INTO cards (guid, deck_id, note_type, front, back, tags,
                                       cloze_count, cloze_index, is_reversed)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        card.guid,
                        deck_id,
                        card.note_type,
                        card.front,
                        card.back,
                        card.tags,
                        card.cloze_count,
                        card.cloze_index,
                        1 if card.is_reversed else 0,
                    ),
                )
                card_id = cursor.lastrowid

                # card_states の初期レコードを作成
                await db.execute(
                    "INSERT INTO card_states (card_id) VALUES (?)",
                    (card_id,),
                )
                cards_created += 1
            except Exception:
                # UNIQUE制約違反 → 既存カードのためスキップ
                skipped += 1

        await db.commit()

        return ImportResponse(
            success=True,
            message=f"インポート完了: {cards_created}枚のカードを作成しました。",
            total_notes_parsed=len(unique_notes),
            total_cards_created=cards_created,
            decks_created=decks_created,
            skipped_existing=skipped,
        )
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"インポートエラー: {str(e)}")
    finally:
        await db.close()
