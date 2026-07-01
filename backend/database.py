# ============================================================
# database.py - データベース管理
# ============================================================
# aiosqliteを使用した非同期SQLite接続と、
# テーブル作成・接続管理を提供する。
# ============================================================

import aiosqlite
from pathlib import Path
from config import settings

# --- テーブル定義SQL（SSOT: スキーマはここに集約） ---

_CREATE_TABLES_SQL = """
-- デッキテーブル
CREATE TABLE IF NOT EXISTS decks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL UNIQUE,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- カードテーブル
CREATE TABLE IF NOT EXISTS cards (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    guid        TEXT    NOT NULL,
    deck_id     INTEGER NOT NULL,
    note_type   TEXT    NOT NULL,
    front       TEXT    NOT NULL,
    back        TEXT    NOT NULL DEFAULT '',
    tags        TEXT    NOT NULL DEFAULT '',
    cloze_count INTEGER NOT NULL DEFAULT 0,
    cloze_index INTEGER NOT NULL DEFAULT 0,
    is_reversed INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE,
    UNIQUE(guid, cloze_index, is_reversed)
);

-- カード学習状態テーブル
CREATE TABLE IF NOT EXISTS card_states (
    card_id         INTEGER PRIMARY KEY,
    ease_factor     REAL    NOT NULL DEFAULT 2.5,
    interval_days   REAL    NOT NULL DEFAULT 0,
    repetitions     INTEGER NOT NULL DEFAULT 0,
    next_review_at  TEXT,
    last_reviewed_at TEXT,
    status          TEXT    NOT NULL DEFAULT 'new',
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
);

-- 復習ログテーブル
CREATE TABLE IF NOT EXISTS review_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id     INTEGER NOT NULL,
    rating      INTEGER NOT NULL,
    reviewed_at TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
);
"""


async def get_connection() -> aiosqlite.Connection:
    """
    データベース接続を取得する。
    外部キー制約を有効化し、WALモードを設定する。
    """
    db = await aiosqlite.connect(settings.DB_PATH)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA foreign_keys = ON")
    await db.execute("PRAGMA journal_mode = WAL")
    return db


async def init_db() -> None:
    """
    データベースを初期化する。
    テーブルが存在しない場合に作成する。
    """
    # DBファイルの親ディレクトリを作成
    db_path = Path(settings.DB_PATH)
    db_path.parent.mkdir(parents=True, exist_ok=True)

    db = await get_connection()
    try:
        await db.executescript(_CREATE_TABLES_SQL)
        await db.commit()
    finally:
        await db.close()
