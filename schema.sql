-- ユーザーアカウントテーブル
CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    username        TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    session_token   TEXT,
    is_admin        INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

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

-- カード学習状態テーブル（user_id でアカウント別管理）
CREATE TABLE IF NOT EXISTS card_states (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id         INTEGER NOT NULL,
    user_id         INTEGER NOT NULL,
    ease_factor     REAL    NOT NULL DEFAULT 2.5,
    interval_days   REAL    NOT NULL DEFAULT 0,
    repetitions     INTEGER NOT NULL DEFAULT 0,
    lapses          INTEGER NOT NULL DEFAULT 0,
    next_review_at  TEXT,
    last_reviewed_at TEXT,
    status          TEXT    NOT NULL DEFAULT 'new',
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(card_id, user_id)
);

-- 復習ログテーブル（user_id でアカウント別管理）
CREATE TABLE IF NOT EXISTS review_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id     INTEGER NOT NULL,
    user_id     INTEGER NOT NULL,
    rating      INTEGER NOT NULL,
    reviewed_at TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- デッキオプションテーブル（user_id でアカウント別管理）
CREATE TABLE IF NOT EXISTS deck_options (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    deck_id          INTEGER NOT NULL,
    user_id          INTEGER NOT NULL,
    max_new_cards    INTEGER NOT NULL DEFAULT 20,
    max_review_cards INTEGER NOT NULL DEFAULT 100,
    review_order     TEXT NOT NULL DEFAULT 'random',
    excluded_tags    TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(deck_id, user_id)
);