import { Hono } from "hono";
import { parseAnkiFile } from "./api/parser";
import { calculateNextReview, Rating } from "./api/srs";

type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
};

type UserContext = {
  id: number;
  username: string;
  is_admin: boolean;
};

const app = new Hono<{ Bindings: Bindings; Variables: { user: UserContext | null } }>().basePath("/api");

// --- パスワードハッシュ ---
async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// --- セッショントークン生成 ---
function generateToken(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 48; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

// --- 認証ミドルウェア ---
app.use("*", async (c, next) => {
  const db = c.env.DB;

  // 自動マイグレーション
  await runMigrations(db);

  const url = new URL(c.req.url);
  const pathname = url.pathname;

  // 認証が不要なエンドポイント
  const publicPaths = ["/api/auth/login", "/api/auth/register"];
  if (publicPaths.includes(pathname)) {
    c.set("user", null);
    await next();
    return;
  }

  // APIルートはセッショントークン認証
  if (pathname.startsWith("/api/")) {
    let token = c.req.query("token");
    if (!token) {
      const authHeader = c.req.header("Authorization");
      if (authHeader && authHeader.startsWith("Bearer ")) {
        token = authHeader.substring(7);
      }
    }

    if (!token) {
      return c.json({ error: "認証エラー: ログインしてください" }, 401);
    }

    const user = await db
      .prepare("SELECT id, username, is_admin FROM users WHERE session_token = ?")
      .bind(token)
      .first<{ id: number; username: string; is_admin: number }>();

    if (!user) {
      return c.json({ error: "認証エラー: 無効なセッションです。再ログインしてください" }, 401);
    }

    c.set("user", { id: user.id, username: user.username, is_admin: !!user.is_admin });
  }

  await next();
});

// --- 自動マイグレーション ---
let migrationDone = false;

async function runMigrations(db: D1Database) {
  if (migrationDone) return;

  // users テーブル作成
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS users (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        username        TEXT NOT NULL UNIQUE,
        password_hash   TEXT NOT NULL,
        session_token   TEXT,
        is_admin        INTEGER NOT NULL DEFAULT 0,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();
  } catch (e) {
    console.error("[Migration] users table creation error:", e);
  }

  // card_states の user_id 対応マイグレーション
  try {
    const info = await db.prepare("PRAGMA table_info(card_states)").all<{ name: string }>();
    const columnNames = info.results.map((r: any) => r.name);
    const hasUserId = columnNames.includes("user_id");

    if (!hasUserId) {
      console.log("[Migration] card_states missing user_id, starting migration...");
      // 1. 安全にリネーム（DDLは暗黙コミットされるので単独で実行）
      await db.prepare("ALTER TABLE card_states RENAME TO card_states_old").run();

      // 2. 新しいテーブルを作成
      await db.prepare(`
        CREATE TABLE card_states (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          card_id         INTEGER NOT NULL,
          user_id         INTEGER NOT NULL,
          ease_factor     REAL NOT NULL DEFAULT 2.5,
          interval_days   REAL NOT NULL DEFAULT 0,
          repetitions     INTEGER NOT NULL DEFAULT 0,
          lapses          INTEGER NOT NULL DEFAULT 0,
          next_review_at  TEXT,
          last_reviewed_at TEXT,
          status          TEXT NOT NULL DEFAULT 'new',
          FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          UNIQUE(card_id, user_id)
        )
      `).run();

      // 3. 旧データを移行（user_id=1 = 管理者に紐付け）
      const hasOldLapses = columnNames.includes("lapses");
      const lapsesCol = hasOldLapses ? "COALESCE(lapses, 0)" : "0";
      await db.prepare(`
        INSERT OR IGNORE INTO card_states (card_id, user_id, ease_factor, interval_days, repetitions, lapses, next_review_at, last_reviewed_at, status)
        SELECT card_id, 1, ease_factor, interval_days, repetitions, ${lapsesCol}, next_review_at, last_reviewed_at, status
        FROM card_states_old
      `).run();

      // 4. 旧テーブル削除
      await db.prepare("DROP TABLE IF EXISTS card_states_old").run();
      console.log("[Migration] card_states migrated successfully");
    }
  } catch (e) {
    console.error("[Migration] card_states migration error:", e);
    // リカバリ: card_states_old が残っていれば元に戻す試行
    try {
      const check = await db.prepare("PRAGMA table_info(card_states_old)").all();
      if (check.results.length > 0) {
        await db.prepare("DROP TABLE IF EXISTS card_states").run();
        await db.prepare("ALTER TABLE card_states_old RENAME TO card_states").run();
        console.log("[Migration] card_states migration rolled back");
      }
    } catch (recoverErr) {
      console.error("[Migration] card_states recovery failed:", recoverErr);
    }
  }

  // review_logs に user_id 追加
  try {
    const info = await db.prepare("PRAGMA table_info(review_logs)").all<{ name: string }>();
    if (!info.results.some((r: any) => r.name === "user_id")) {
      await db.prepare("ALTER TABLE review_logs ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1").run();
      console.log("[Migration] review_logs.user_id added");
    }
  } catch (e) {
    console.error("[Migration] review_logs migration error:", e);
  }

  // deck_options の user_id 対応マイグレーション
  try {
    const info = await db.prepare("PRAGMA table_info(deck_options)").all<{ name: string }>();
    const columnNames = info.results.map((r: any) => r.name);
    const hasUserId = columnNames.includes("user_id");

    if (!hasUserId) {
      console.log("[Migration] deck_options missing user_id, starting migration...");
      await db.prepare("ALTER TABLE deck_options RENAME TO deck_options_old").run();

      const hasExcludedTags = columnNames.includes("excluded_tags");
      await db.prepare(`
        CREATE TABLE deck_options (
          id               INTEGER PRIMARY KEY AUTOINCREMENT,
          deck_id          INTEGER NOT NULL,
          user_id          INTEGER NOT NULL,
          max_new_cards    INTEGER NOT NULL DEFAULT 20,
          max_review_cards INTEGER NOT NULL DEFAULT 100,
          review_order     TEXT NOT NULL DEFAULT 'random',
          excluded_tags    TEXT NOT NULL DEFAULT '',
          exclude_reversed INTEGER NOT NULL DEFAULT 0,
          FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          UNIQUE(deck_id, user_id)
        )
      `).run();

      const excludedTagsCol = hasExcludedTags ? "excluded_tags" : "''";
      await db.prepare(`
        INSERT OR IGNORE INTO deck_options (deck_id, user_id, max_new_cards, max_review_cards, review_order, excluded_tags, exclude_reversed)
        SELECT deck_id, 1, max_new_cards, max_review_cards, review_order, ${excludedTagsCol}, 0
        FROM deck_options_old
      `).run();

      await db.prepare("DROP TABLE IF EXISTS deck_options_old").run();
      console.log("[Migration] deck_options migrated successfully");
    }
  } catch (e) {
    console.error("[Migration] deck_options migration error:", e);
    try {
      const check = await db.prepare("PRAGMA table_info(deck_options_old)").all();
      if (check.results.length > 0) {
        await db.prepare("DROP TABLE IF EXISTS deck_options").run();
        await db.prepare("ALTER TABLE deck_options_old RENAME TO deck_options").run();
        console.log("[Migration] deck_options migration rolled back");
      }
    } catch (recoverErr) {
      console.error("[Migration] deck_options recovery failed:", recoverErr);
    }
  }

  // deck_options に exclude_reversed カラムがなければ追加
  try {
    const info = await db.prepare("PRAGMA table_info(deck_options)").all<{ name: string }>();
    if (!info.results.some((r: any) => r.name === "exclude_reversed")) {
      await db.prepare("ALTER TABLE deck_options ADD COLUMN exclude_reversed INTEGER NOT NULL DEFAULT 0").run();
      console.log("[Migration] deck_options.exclude_reversed added");
    }
  } catch (e) {
    console.error("[Migration] deck_options.exclude_reversed migration error:", e);
  }

  // 「スキル把握」デッキの反転カード除外をデフォルトONに設定
  try {
    const skillDeck = await db.prepare("SELECT id FROM decks WHERE name = 'スキル把握'").first<{ id: number }>();
    if (skillDeck) {
      // 既存ユーザー全員分の deck_options 行がない場合は作成
      await db.prepare(`
        INSERT OR IGNORE INTO deck_options (deck_id, user_id)
        SELECT ?, id FROM users
      `).bind(skillDeck.id).run();
      // exclude_reversed を 1 に設定
      await db.prepare(`
        UPDATE deck_options SET exclude_reversed = 1 WHERE deck_id = ?
      `).bind(skillDeck.id).run();
      console.log("[Migration] スキル把握 deck exclude_reversed set to 1");
    }
  } catch (e) {
    console.error("[Migration] スキル把握 exclude_reversed setting error:", e);
  }

  // 管理者アカウントのシード（id=1）
  try {
    const adminHash = await sha256("SukilHaakuAdmin116");
    await db.prepare(`
      INSERT OR IGNORE INTO users (id, username, password_hash, is_admin)
      VALUES (1, '2379862', ?, 1)
    `).bind(adminHash).run();
  } catch (e) {
    console.error("[Migration] admin seed error:", e);
  }

  migrationDone = true;
}

// --- ユーザーIDを取得するヘルパー ---
function getUserId(c: any): number {
  const user = c.get("user") as UserContext | null;
  if (!user) throw new Error("認証が必要です");
  return user.id;
}

// --- APIレスポンス用のヘルパー関数 ---

async function getDeckCounts(db: D1Database, deckId: number, userId: number) {
  const query = `
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN cs.status = 'new' OR cs.status IS NULL THEN 1 ELSE 0 END) as new_count,
      SUM(CASE WHEN cs.status = 'learning' THEN 1 ELSE 0 END) as learning_count,
      SUM(CASE WHEN cs.status = 'review' THEN 1 ELSE 0 END) as review_count
    FROM cards c
    LEFT JOIN card_states cs ON c.id = cs.card_id AND cs.user_id = ?
    WHERE c.deck_id = ?
  `;
  const result = await db.prepare(query).bind(userId, deckId).first<{
    total: number;
    new_count: number;
    learning_count: number;
    review_count: number;
  }>();

  return {
    total: result?.total || 0,
    new_count: result?.new_count || 0,
    learning_count: result?.learning_count || 0,
    review_count: result?.review_count || 0,
  };
}

async function getStudyableCount(db: D1Database, deckId: number, excludedTags: string, userId: number) {
  const excludedList = excludedTags ? excludedTags.trim().split(/\s+/).filter(Boolean) : [];
  if (excludedList.length === 0) {
    const counts = await getDeckCounts(db, deckId, userId);
    return counts.total;
  }

  const { results: allRows } = await db
    .prepare("SELECT tags FROM cards WHERE deck_id = ? AND tags != ''")
    .bind(deckId)
    .all<{ tags: string }>();
  const allTags = new Set<string>();
  for (const row of allRows) {
    for (const tag of row.tags.trim().split(/\s+/)) {
      if (tag) allTags.add(tag);
    }
  }

  const includedTags = [...allTags].filter((t) => !excludedList.includes(t));
  if (includedTags.length === 0) return 0;

  const conditions = includedTags.map(() => `INSTR(' ' || c.tags || ' ', ?) > 0`);
  const params: any[] = includedTags.map((t) => ` ${t} `);
  const result = await db
    .prepare(`SELECT COUNT(*) as total FROM cards c WHERE c.deck_id = ? AND (${conditions.join(" OR ")})`)
    .bind(deckId, ...params)
    .first<{ total: number }>();
  return result?.total || 0;
}

// --- 認証エンドポイント ---

app.post("/auth/login", async (c) => {
  const db = c.env.DB;
  try {
    const { username, password } = await c.req.json<{ username: string; password: string }>();

    if (!username || username.trim() === "") {
      return c.json({ error: "IDを入力してください" }, 400);
    }

    const user = await db
      .prepare("SELECT id, username, password_hash, is_admin FROM users WHERE username = ?")
      .bind(username.trim())
      .first<{ id: number; username: string; password_hash: string; is_admin: number }>();

    if (!user) {
      // IDが存在しない
      if (!password || password.trim() === "") {
        return c.json({ status: "new_account", username: username.trim() }, 200);
      }
      return c.json({ error: "アカウントが存在しません" }, 404);
    }

    // IDが存在する → パスワード検証
    const inputHash = await sha256(password);
    if (inputHash !== user.password_hash) {
      return c.json({ error: "パスワードが正しくありません" }, 401);
    }

    // ログイン成功 → セッショントークン発行
    const token = generateToken();
    await db.prepare("UPDATE users SET session_token = ? WHERE id = ?").bind(token, user.id).run();

    return c.json({
      success: true,
      token,
      is_admin: !!user.is_admin,
      username: user.username,
    });
  } catch (err: any) {
    return c.json({ error: `ログインエラー: ${err.message}` }, 500);
  }
});

app.post("/auth/register", async (c) => {
  const db = c.env.DB;
  try {
    const { username, password } = await c.req.json<{ username: string; password: string }>();

    if (!username || username.trim() === "") {
      return c.json({ error: "IDを入力してください" }, 400);
    }
    if (!password || password.trim() === "") {
      return c.json({ error: "パスワードを入力してください" }, 400);
    }

    const uname = username.trim();
    const existing = await db.prepare("SELECT id FROM users WHERE username = ?").bind(uname).first();
    if (existing) {
      return c.json({ error: "このIDは既に使用されています" }, 409);
    }

    const passwordHash = await sha256(password);
    const token = generateToken();
    await db
      .prepare("INSERT INTO users (username, password_hash, session_token, is_admin) VALUES (?, ?, ?, 0)")
      .bind(uname, passwordHash, token)
      .run();

    return c.json({
      success: true,
      token,
      is_admin: false,
      username: uname,
    });
  } catch (err: any) {
    return c.json({ error: `アカウント作成エラー: ${err.message}` }, 500);
  }
});

app.post("/auth/logout", async (c) => {
  const db = c.env.DB;
  try {
    const userId = getUserId(c);
    await db.prepare("UPDATE users SET session_token = NULL WHERE id = ?").bind(userId).run();
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: `ログアウトエラー: ${err.message}` }, 500);
  }
});

app.get("/auth/me", async (c) => {
  const user = c.get("user") as UserContext | null;
  if (!user) {
    return c.json({ error: "認証されていません" }, 401);
  }
  return c.json({
    id: user.id,
    username: user.username,
    is_admin: user.is_admin,
  });
});

// --- 管理者用ユーティリティ ---

function requireAdmin(c: any): UserContext {
  const user = c.get("user") as UserContext | null;
  if (!user || !user.is_admin) {
    throw new Error("管理者権限が必要です");
  }
  return user;
}

// --- 管理者エンドポイント ---

// ユーザー一覧
app.get("/admin/users", async (c) => {
  const db = c.env.DB;
  try {
    requireAdmin(c);
    const { results: users } = await db
      .prepare("SELECT id, username, is_admin, created_at, session_token IS NOT NULL as logged_in FROM users ORDER BY id")
      .all<{ id: number; username: string; is_admin: number; created_at: string; logged_in: number }>();

    return c.json(
      users.map((u) => ({
        id: u.id,
        username: u.username,
        is_admin: !!u.is_admin,
        created_at: u.created_at,
        logged_in: !!u.logged_in,
      }))
    );
  } catch (err: any) {
    if (err.message === "管理者権限が必要です") {
      return c.json({ error: err.message }, 403);
    }
    return c.json({ error: `ユーザー一覧取得エラー: ${err.message}` }, 500);
  }
});

// アカウント削除
app.delete("/admin/users/:userId", async (c) => {
  const db = c.env.DB;
  try {
    const admin = requireAdmin(c);
    const userId = parseInt(c.req.param("userId"), 10);

    if (isNaN(userId)) return c.json({ error: "無効なユーザーIDです" }, 400);

    const target = await db
      .prepare("SELECT id, username, is_admin FROM users WHERE id = ?")
      .bind(userId)
      .first<{ id: number; username: string; is_admin: number }>();

    if (!target) return c.json({ error: "ユーザーが見つかりません" }, 404);
    if (target.is_admin) return c.json({ error: "管理者アカウントは削除できません" }, 400);
    if (target.id === admin.id) return c.json({ error: "自分自身は削除できません" }, 400);

    // 関連データ削除 + ユーザー削除
    await db.batch([
      db.prepare("DELETE FROM card_states WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM review_logs WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM deck_options WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM users WHERE id = ?").bind(userId),
    ]);

    return c.json({ success: true, message: `アカウント「${target.username}」を削除しました` });
  } catch (err: any) {
    if (err.message === "管理者権限が必要です") {
      return c.json({ error: err.message }, 403);
    }
    return c.json({ error: `アカウント削除エラー: ${err.message}` }, 500);
  }
});

// パスワード変更
app.post("/admin/users/:userId/password", async (c) => {
  const db = c.env.DB;
  try {
    requireAdmin(c);
    const userId = parseInt(c.req.param("userId"), 10);

    if (isNaN(userId)) return c.json({ error: "無効なユーザーIDです" }, 400);

    const { password } = await c.req.json<{ password: string }>();
    if (!password || password.trim() === "") {
      return c.json({ error: "新しいパスワードを入力してください" }, 400);
    }

    const target = await db.prepare("SELECT id, username FROM users WHERE id = ?").bind(userId).first<{ id: number; username: string }>();
    if (!target) return c.json({ error: "ユーザーが見つかりません" }, 404);

    const passwordHash = await sha256(password);
    await db.prepare("UPDATE users SET password_hash = ?, session_token = NULL WHERE id = ?").bind(passwordHash, userId).run();

    return c.json({ success: true, message: `アカウント「${target.username}」のパスワードを変更しました` });
  } catch (err: any) {
    if (err.message === "管理者権限が必要です") {
      return c.json({ error: err.message }, 403);
    }
    return c.json({ error: `パスワード変更エラー: ${err.message}` }, 500);
  }
});

// 学習状態リセット
app.post("/admin/users/:userId/reset", async (c) => {
  const db = c.env.DB;
  try {
    requireAdmin(c);
    const userId = parseInt(c.req.param("userId"), 10);

    if (isNaN(userId)) return c.json({ error: "無効なユーザーIDです" }, 400);

    const target = await db.prepare("SELECT id, username FROM users WHERE id = ?").bind(userId).first<{ id: number; username: string }>();
    if (!target) return c.json({ error: "ユーザーが見つかりません" }, 404);

    // 学習状態をリセット（card_statesを削除して再作成 = 初期状態に戻す）
    await db.batch([
      db.prepare("DELETE FROM review_logs WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM card_states WHERE user_id = ?").bind(userId),
    ]);

    return c.json({ success: true, message: `アカウント「${target.username}」の学習状態をリセットしました` });
  } catch (err: any) {
    if (err.message === "管理者権限が必要です") {
      return c.json({ error: err.message }, 403);
    }
    return c.json({ error: `学習状態リセットエラー: ${err.message}` }, 500);
  }
});

// --- ルーティング定義 ---

app.get("/decks", async (c) => {
  const db = c.env.DB;
  const userId = getUserId(c);
  try {
    const { results: decks } = await db
      .prepare("SELECT id, name, created_at FROM decks ORDER BY name")
      .all<{ id: number; name: string; created_at: string }>();

    const result = [];
    for (const deck of decks) {
      const counts = await getDeckCounts(db, deck.id, userId);

      const options = await db
        .prepare("SELECT max_new_cards, max_review_cards, excluded_tags FROM deck_options WHERE deck_id = ? AND user_id = ?")
        .bind(deck.id, userId)
        .first<{ max_new_cards: number; max_review_cards: number; excluded_tags: string }>();
      const dailyTaskLimit = (options?.max_new_cards || 20) + (options?.max_review_cards || 100);

      const studyableCount = await getStudyableCount(db, deck.id, options?.excluded_tags || "", userId);

      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);
      const todayResult = await db
        .prepare(
          `SELECT COUNT(*) as today FROM review_logs
           WHERE reviewed_at >= ? AND card_id IN (SELECT id FROM cards WHERE deck_id = ?) AND user_id = ?`
        )
        .bind(todayStart.toISOString(), deck.id, userId)
        .first<{ today: number }>();
      const reviewsToday = todayResult?.today || 0;
      const dailyRemaining = Math.max(0, dailyTaskLimit - reviewsToday);

      result.push({
        id: deck.id,
        name: deck.name,
        created_at: deck.created_at,
        card_count: counts.total,
        studyable_count: studyableCount,
        new_count: counts.new_count,
        learning_count: counts.learning_count,
        review_count: counts.review_count,
        reviews_today: reviewsToday,
        daily_remaining: dailyRemaining,
        card_counts: {
          total: counts.total,
          new: counts.new_count,
          learning: counts.learning_count,
          review: counts.review_count,
        },
      });
    }

    return c.json(result, 200, { "Cache-Control": "no-store, no-cache, must-revalidate" });
  } catch (err: any) {
    return c.json({ error: `デッキ一覧取得エラー: ${err.message}` }, 500);
  }
});

// --- インポート: ファイル解析（プレビュー） ---
app.post("/import/preview", async (c) => {
  const db = c.env.DB;
  try {
    const formData = await c.req.raw.formData();
    const file = formData.get("file") as File;
    if (!file) return c.json({ error: "ファイルがアップロードされていません" }, 400);

    const raw = await file.arrayBuffer();
    const decoder = new TextDecoder("utf-8");
    const content = decoder.decode(raw);

    const parsedCards = parseAnkiFile(content);
    if (parsedCards.length === 0) {
      return c.json({ success: false, message: "カードが見つかりませんでした。ファイル形式を確認してください。" });
    }

    // 既存カードの有無を確認する
    const existingKeys = new Set<string>();
    const allGuids = Array.from(new Set(parsedCards.map((c) => c.guid)));
    const GUID_BATCH = 100;
    for (let i = 0; i < allGuids.length; i += GUID_BATCH) {
      const chunk = allGuids.slice(i, i + GUID_BATCH);
      const placeholders = chunk.map(() => "?").join(", ");
      const rows = await db
        .prepare(`SELECT guid, cloze_index, is_reversed FROM cards WHERE guid IN (${placeholders})`)
        .bind(...chunk)
        .all<{ guid: string; cloze_index: number; is_reversed: number }>();
      for (const row of rows.results) {
        existingKeys.add(`${row.guid}:${row.cloze_index}:${row.is_reversed}`);
      }
    }

    const newCards: typeof parsedCards = [];
    const existingCards: typeof parsedCards = [];
    for (const card of parsedCards) {
      const key = `${card.guid}:${card.cloze_index}:${card.is_reversed ? 1 : 0}`;
      if (existingKeys.has(key)) {
        existingCards.push(card);
      } else {
        newCards.push(card);
      }
    }

    const uniqueDeckNames = Array.from(new Set(parsedCards.map((c) => c.deck_name)));

    return c.json({
      success: true,
      summary: {
        total: parsedCards.length,
        new_count: newCards.length,
        existing_count: existingCards.length,
      },
      cards: parsedCards.map((card) => {
        const key = `${card.guid}:${card.cloze_index}:${card.is_reversed ? 1 : 0}`;
        return {
          guid: card.guid,
          note_type: card.note_type,
          deck_name: card.deck_name,
          front: card.front,
          back: card.back,
          tags: card.tags,
          cloze_count: card.cloze_count,
          cloze_index: card.cloze_index,
          is_reversed: card.is_reversed,
          is_new: !existingKeys.has(key),
        };
      }),
      decks: uniqueDeckNames,
    });
  } catch (err: any) {
    console.error("Preview error:", err.stack || err);
    return c.json({ error: `プレビューエラー: ${err.message}` }, 500);
  }
});

// --- インポート: 実行 ---
app.post("/import", async (c) => {
  const db = c.env.DB;
  const userId = getUserId(c);
  try {
    const formData = await c.req.raw.formData();
    const file = formData.get("file") as File;
    const mode = (formData.get("mode") as string) || "skip";

    if (!file) {
      return c.json({ error: "ファイルがアップロードされていません" }, 400);
    }

    const raw = await file.arrayBuffer();
    const decoder = new TextDecoder("utf-8");
    const content = decoder.decode(raw);

    const parsedCards = parseAnkiFile(content);
    if (parsedCards.length === 0) {
      return c.json({ success: false, message: "カードが見つかりませんでした。ファイル形式を確認してください。" });
    }

    const deckCache: Record<string, number> = {};
    const decksCreated: string[] = [];
    const uniqueNotes = new Set<string>();

    const uniqueDeckNames = Array.from(new Set(parsedCards.map((c) => c.deck_name)));

    const existingDecks = await db.prepare("SELECT id, name FROM decks").all<{ id: number; name: string }>();
    for (const d of existingDecks.results) {
      deckCache[d.name] = d.id;
    }

    const missingDecks = uniqueDeckNames.filter((name) => !deckCache[name]);
    if (missingDecks.length > 0) {
      const deckPlaceholders = missingDecks.map(() => "(?)").join(", ");
      await db.prepare(`INSERT OR IGNORE INTO decks (name) VALUES ${deckPlaceholders}`).bind(...missingDecks).run();
      const newDecks = await db.prepare("SELECT id, name FROM decks").all<{ id: number; name: string }>();
      for (const d of newDecks.results) {
        deckCache[d.name] = d.id;
        if (missingDecks.includes(d.name)) {
          decksCreated.push(d.name);
        }
      }
    }

    let cardsCreated = 0;
    let cardsSkipped = 0;
    let cardsUpdated = 0;

    const BATCH_SIZE = 10;
    const stmts: ReturnType<typeof db.prepare>[] = [];

    if (mode === "update") {
      // 上書きモード: UPDATE + INSERT
      for (let i = 0; i < parsedCards.length; i += BATCH_SIZE) {
        const chunk = parsedCards.slice(i, i + BATCH_SIZE);
        for (const card of chunk) {
          uniqueNotes.add(card.guid);
          // 既存カードをUPDATE
          stmts.push(
            db
              .prepare(`UPDATE cards SET deck_id = ?, note_type = ?, front = ?, back = ?, tags = ?, cloze_count = ? WHERE guid = ? AND cloze_index = ? AND is_reversed = ?`)
              .bind(
                deckCache[card.deck_name],
                card.note_type,
                card.front,
                card.back,
                card.tags,
                card.cloze_count,
                card.guid,
                card.cloze_index,
                card.is_reversed ? 1 : 0
              )
          );
          // 存在しなければINSERT (changes=0なら挿入)
          stmts.push(
            db
              .prepare(`INSERT OR IGNORE INTO cards (guid, deck_id, note_type, front, back, tags, cloze_count, cloze_index, is_reversed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
              .bind(
                card.guid,
                deckCache[card.deck_name],
                card.note_type,
                card.front,
                card.back,
                card.tags,
                card.cloze_count,
                card.cloze_index,
                card.is_reversed ? 1 : 0
              )
          );
        }
      }
    } else {
      // スキップモード: INSERT OR IGNORE (従来通り)
      for (let i = 0; i < parsedCards.length; i += BATCH_SIZE) {
        const chunk = parsedCards.slice(i, i + BATCH_SIZE);
        const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
        const params: any[] = [];
        for (const card of chunk) {
          uniqueNotes.add(card.guid);
          params.push(
            card.guid,
            deckCache[card.deck_name],
            card.note_type,
            card.front,
            card.back,
            card.tags,
            card.cloze_count,
            card.cloze_index,
            card.is_reversed ? 1 : 0
          );
        }
        stmts.push(
          db
            .prepare(`INSERT OR IGNORE INTO cards (guid, deck_id, note_type, front, back, tags, cloze_count, cloze_index, is_reversed) VALUES ${placeholders}`)
            .bind(...params)
        );
      }
    }

    stmts.push(db.prepare(`INSERT OR IGNORE INTO card_states (card_id, user_id) SELECT id, ? FROM cards`).bind(userId));

    const batchResults = await db.batch(stmts);
    if (mode === "update") {
      // UPDATEは2文/カード (UPDATE+INSERT)
      for (let r = 0; r < batchResults.length - 1; r += 2) {
        const updateChanges = batchResults[r].meta?.changes || 0;
        const insertChanges = batchResults[r + 1]?.meta?.changes || 0;
        if (updateChanges > 0) cardsUpdated += updateChanges;
        if (insertChanges > 0) cardsCreated += insertChanges;
      }
      // UPDATEで影響がなかった(= 新規だった)ものは cardsUpdated に含まれない
      // 実際の更新数 = parsedCards.length - cardsCreated
      cardsUpdated = parsedCards.length - cardsCreated;
      // changes==0のUPDATEもstmtsに含まれているので、単純にparsedCards.length - cardsCreated
      // ただし、changes==0は実際には更新がない既存カード
      // cardsSkipped はこのモードでは0（更新対象は全てUPDATEされる）
    } else {
      for (let r = 0; r < batchResults.length - 1; r++) {
        if (batchResults[r].meta && batchResults[r].meta.changes) {
          cardsCreated += batchResults[r].meta.changes;
        }
      }
      cardsSkipped = parsedCards.length - cardsCreated;
    }

    const { results: deckCountRows } = await db
      .prepare(
        `SELECT c.deck_id, COUNT(*) as total
         FROM cards c
         WHERE c.deck_id IN (${uniqueDeckNames.map(() => "?").join(",")})
         GROUP BY c.deck_id`
      )
      .bind(...uniqueDeckNames.map((n) => deckCache[n]))
      .all<{ deck_id: number; total: number }>();

    const deckCountMap: Record<number, number> = {};
    for (const row of deckCountRows) {
      deckCountMap[row.deck_id] = row.total;
    }

    const importedDecks = uniqueDeckNames.map((name) => ({
      name,
      card_count: deckCountMap[deckCache[name]] || 0,
    }));

    const resp: any = {
      success: true,
      mode,
      total_cards: parsedCards.length,
      imported_count: cardsCreated,
      updated_count: cardsUpdated,
      skipped_count: cardsSkipped,
      total_notes_parsed: uniqueNotes.size,
      decks_created: decksCreated,
      decks: importedDecks,
    };

    if (mode === "skip") {
      resp.message = `インポート完了: ${cardsCreated}枚作成, ${cardsSkipped}枚スキップ`;
    } else {
      resp.message = `インポート完了: ${cardsCreated}枚新規作成, ${cardsUpdated}枚更新`;
    }

    return c.json(resp);
  } catch (err: any) {
    console.error("Import error:", err.stack || err);
    return c.json({ error: `インポートエラー: ${err.message}` }, 500);
  }
});

// デッキオプション取得
app.get("/decks/:deckId/options", async (c) => {
  const db: D1Database = c.env.DB;
  const userId = getUserId(c);
  const deckIdStr = c.req.param("deckId");
  const deckId = parseInt(deckIdStr, 10);

  if (isNaN(deckId)) return c.json({ error: "無効なデッキIDです" }, 400);

  let options = await db
    .prepare(
      "SELECT max_new_cards, max_review_cards, review_order, excluded_tags, exclude_reversed FROM deck_options WHERE deck_id = ? AND user_id = ?"
    )
    .bind(deckId, userId)
    .first<{ max_new_cards: number; max_review_cards: number; review_order: string; excluded_tags: string; exclude_reversed: number }>();

  if (!options) {
    options = {
      max_new_cards: 20,
      max_review_cards: 100,
      review_order: "random",
      excluded_tags: "",
      exclude_reversed: 0,
    };
  }

  return c.json(options);
});

// デッキオプション更新
app.post("/decks/:deckId/options", async (c) => {
  const db: D1Database = c.env.DB;
  const userId = getUserId(c);
  const deckIdStr = c.req.param("deckId");
  const deckId = parseInt(deckIdStr, 10);

  if (isNaN(deckId)) return c.json({ error: "無効なデッキIDです" }, 400);

  const body = await c.req.json();
  const maxNew = typeof body.max_new_cards === "number" ? body.max_new_cards : 20;
  const maxRev = typeof body.max_review_cards === "number" ? body.max_review_cards : 100;
  const order = body.review_order === "sequential" ? "sequential" : "random";
  const excludedTags = typeof body.excluded_tags === "string" ? body.excluded_tags : "";
  const excludeReversed = body.exclude_reversed === true || body.exclude_reversed === 1 ? 1 : 0;

  await db
    .prepare(
      `INSERT INTO deck_options (deck_id, user_id, max_new_cards, max_review_cards, review_order, excluded_tags, exclude_reversed)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(deck_id, user_id) DO UPDATE SET
         max_new_cards = excluded.max_new_cards,
         max_review_cards = excluded.max_review_cards,
         review_order = excluded.review_order,
         excluded_tags = excluded.excluded_tags,
         exclude_reversed = excluded.exclude_reversed`
    )
    .bind(deckId, userId, maxNew, maxRev, order, excludedTags, excludeReversed)
    .run();

  return c.json({ success: true });
});

// デッキ内タグ一覧
app.get("/decks/:deckId/tags", async (c) => {
  const db: D1Database = c.env.DB;
  const deckId = parseInt(c.req.param("deckId"), 10);
  if (isNaN(deckId)) return c.json({ error: "無効なデッキIDです" }, 400);

  try {
    const { results: rows } = await db
      .prepare("SELECT tags FROM cards WHERE deck_id = ? AND tags != ''")
      .bind(deckId)
      .all<{ tags: string }>();

    const tagCount: Record<string, number> = {};
    for (const row of rows) {
      const tags = row.tags.trim().split(/\s+/);
      for (const tag of tags) {
        if (tag) tagCount[tag] = (tagCount[tag] || 0) + 1;
      }
    }
    const sorted = Object.entries(tagCount)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => a.tag.localeCompare(b.tag));
    return c.json(sorted);
  } catch (err: any) {
    return c.json({ error: `タグ取得エラー: ${err.message}` }, 500);
  }
});

// 出題
app.get("/decks/:deckId/study", async (c) => {
  const db = c.env.DB;
  const userId = getUserId(c);
  const deckId = parseInt(c.req.param("deckId"), 10);

  try {
    const deckExists = await db.prepare("SELECT id FROM decks WHERE id = ?").bind(deckId).first();
    if (!deckExists) {
      return c.json({ error: "デッキが見つかりません" }, 404);
    }

    const nowIso = new Date().toISOString();

    const cards: any[] = [];

    let options = await db
      .prepare(
        "SELECT max_new_cards, max_review_cards, review_order, excluded_tags, exclude_reversed FROM deck_options WHERE deck_id = ? AND user_id = ?"
      )
      .bind(deckId, userId)
      .first<{ max_new_cards: number; max_review_cards: number; review_order: string; excluded_tags: string; exclude_reversed: number }>();
    if (!options) {
      options = { max_new_cards: 20, max_review_cards: 100, review_order: "random", excluded_tags: "", exclude_reversed: 0 };
    }

    // 反転カード除外オプション
    const reversedFilterSql = options.exclude_reversed ? " AND c.is_reversed = 0" : "";

    const excludedTagList = options.excluded_tags
      ? options.excluded_tags.trim().split(/\s+/).filter(Boolean)
      : [];
    let tagFilterSql = "";
    const tagFilterParams: any[] = [];
    if (excludedTagList.length > 0) {
      const { results: tagRows } = await db
        .prepare("SELECT tags FROM cards WHERE deck_id = ? AND tags != ''")
        .bind(deckId)
        .all<{ tags: string }>();
      const allTags = new Set<string>();
      for (const row of tagRows) {
        for (const t of row.tags.trim().split(/\s+/)) {
          if (t) allTags.add(t);
        }
      }
      const includedTags = [...allTags].filter((t) => !excludedTagList.includes(t));
      if (includedTags.length > 0) {
        const conditions = includedTags.map(() => `INSTR(' ' || c.tags || ' ', ?) > 0`);
        tagFilterParams.push(...includedTags.map((t) => ` ${t} `));
        tagFilterSql = ` AND (${conditions.join(" OR ")})`;
      } else {
        tagFilterSql = " AND 1=0";
      }
    }

    // Ensure card_states row exists for this user
    await db
      .prepare(
        `INSERT OR IGNORE INTO card_states (card_id, user_id)
         SELECT c.id, ? FROM cards c LEFT JOIN card_states cs ON c.id = cs.card_id AND cs.user_id = ?
         WHERE c.deck_id = ? AND cs.id IS NULL`
      )
      .bind(userId, userId, deckId)
      .run();

    // 1. new cards
    const newBatchSize = options.max_new_cards;
    if (newBatchSize > 0) {
      const { results: newCards } = await db
        .prepare(
          `SELECT c.*, cs.ease_factor, cs.interval_days, cs.repetitions, cs.lapses, cs.status, cs.next_review_at
           FROM cards c
           JOIN card_states cs ON c.id = cs.card_id AND cs.user_id = ?
           WHERE c.deck_id = ? AND cs.status = 'new'${tagFilterSql}${reversedFilterSql}
           ORDER BY RANDOM()
           LIMIT ?`
        )
        .bind(userId, deckId, ...tagFilterParams, newBatchSize)
        .all();
      cards.push(...newCards);
    }

    // 2. review/learning cards
    const reviewBatchSize = options.max_review_cards;
    if (reviewBatchSize > 0) {
      const { results: reviewCards } = await db
        .prepare(
          `SELECT c.*, cs.ease_factor, cs.interval_days, cs.repetitions, cs.lapses, cs.status, cs.next_review_at
           FROM cards c
           JOIN card_states cs ON c.id = cs.card_id AND cs.user_id = ?
            WHERE c.deck_id = ? AND cs.status IN ('learning', 'review')
              AND (cs.next_review_at IS NULL OR cs.next_review_at <= ?)${tagFilterSql}${reversedFilterSql}
           ORDER BY cs.next_review_at
           LIMIT ?`
        )
        .bind(userId, deckId, nowIso, ...tagFilterParams, reviewBatchSize)
        .all();
      cards.push(...reviewCards);
    }

    if (options.review_order === "random") {
      for (let i = cards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cards[i], cards[j]] = [cards[j], cards[i]];
      }
    }

    // Count today's reviews for cumulative progress display
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayResult = await db
      .prepare(
        `SELECT COUNT(*) as cnt FROM review_logs rl
         JOIN cards c ON rl.card_id = c.id
         WHERE c.deck_id = ? AND rl.user_id = ? AND rl.reviewed_at >= ?`
      )
      .bind(deckId, userId, todayStart.toISOString())
      .first<{ cnt: number }>();
    const reviewsToday = todayResult?.cnt || 0;
    const dailyLimit = (options.max_new_cards || 0) + (options.max_review_cards || 0);

    return c.json(
      {
        cards: cards.map((row) => ({
          id: row.id,
          guid: row.guid,
          deck_id: row.deck_id,
          note_type: row.note_type,
          front: row.front,
          back: row.back,
          tags: row.tags,
          cloze_count: row.cloze_count,
          cloze_index: row.cloze_index,
          is_reversed: !!row.is_reversed,
          ease_factor: row.ease_factor,
          interval_days: row.interval_days,
          repetitions: row.repetitions,
          lapses: row.lapses,
          status: row.status,
          next_review_at: row.next_review_at,
        })),
        reviews_today: reviewsToday,
        daily_limit: dailyLimit,
      },
      200,
      { "Cache-Control": "no-store, no-cache, must-revalidate" }
    );
  } catch (err: any) {
    return c.json({ error: `学習カード取得エラー: ${err.message}` }, 500);
  }
});

// 復習結果の登録
app.post("/cards/:cardId/review", async (c) => {
  const db = c.env.DB;
  const userId = getUserId(c);
  const cardId = parseInt(c.req.param("cardId"), 10);

  try {
    const { rating } = await c.req.json<{ rating: number }>();

    if (!rating || rating < 1 || rating > 4) {
      return c.json({ error: "不正な評価値です (1-4)" }, 400);
    }

    // Ensure card_states exists for this user
    await db
      .prepare("INSERT OR IGNORE INTO card_states (card_id, user_id) VALUES (?, ?)")
      .bind(cardId, userId)
      .run();

    const stateRow = await db
      .prepare(
        "SELECT ease_factor, interval_days, repetitions, lapses, status FROM card_states WHERE card_id = ? AND user_id = ?"
      )
      .bind(cardId, userId)
      .first<{ ease_factor: number; interval_days: number; repetitions: number; lapses: number; status: string }>();

    if (!stateRow) {
      return c.json({ error: "カードが見つかりません" }, 404);
    }

    const result = calculateNextReview(
      {
        easeFactor: stateRow.ease_factor,
        intervalDays: stateRow.interval_days,
        repetitions: stateRow.repetitions,
        lapses: stateRow.lapses,
        status: stateRow.status,
      },
      rating as Rating
    );

    const nowIso = new Date().toISOString();
    const nextReviewIso = result.nextReviewAt.toISOString();

    await db.batch([
      db
        .prepare(
          `UPDATE card_states
           SET ease_factor = ?, interval_days = ?, repetitions = ?, lapses = ?,
               next_review_at = ?, last_reviewed_at = ?, status = ?
           WHERE card_id = ? AND user_id = ?`
        )
        .bind(
          result.easeFactor,
          result.intervalDays,
          result.repetitions,
          result.lapses,
          nextReviewIso,
          nowIso,
          result.status,
          cardId,
          userId
        ),
      db
        .prepare("INSERT INTO review_logs (card_id, user_id, rating, reviewed_at) VALUES (?, ?, ?, ?)")
        .bind(cardId, userId, rating, nowIso),
    ]);

    return c.json({
      card_id: cardId,
      rating,
      ease_factor: result.easeFactor,
      interval_days: result.intervalDays,
      repetitions: result.repetitions,
      lapses: result.lapses,
      next_review_at: nextReviewIso,
      status: result.status,
    });
  } catch (err: any) {
    return c.json({ error: `復習登録エラー: ${err.message}` }, 500);
  }
});

// 統計情報の共通集計処理
async function aggregateStats(db: D1Database, userId: number, deckId?: number) {
  let cardWhere = "WHERE cs.user_id = ?";
  let cardParams: any[] = [userId];
  if (deckId !== undefined) {
    cardWhere = "WHERE c.deck_id = ? AND cs.user_id = ?";
    cardParams = [deckId, userId];
  }

  const countsQuery = `
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN cs.status = 'new' OR cs.status IS NULL THEN 1 ELSE 0 END) as new_count,
      SUM(CASE WHEN cs.status = 'learning' THEN 1 ELSE 0 END) as learning_count,
      SUM(CASE WHEN cs.status = 'review' THEN 1 ELSE 0 END) as review_count
    FROM cards c
    LEFT JOIN card_states cs ON c.id = cs.card_id AND cs.user_id = ?
    ${deckId !== undefined ? "WHERE c.deck_id = ?" : ""}
  `;
  const counts = await db
    .prepare(countsQuery)
    .bind(userId, ...(deckId !== undefined ? [deckId] : []))
    .first<{
      total: number;
      new_count: number;
      learning_count: number;
      review_count: number;
    }>();

  const total = counts?.total || 0;
  const newCount = counts?.new_count || 0;
  const learningCount = counts?.learning_count || 0;
  const reviewCount = counts?.review_count || 0;
  const masteredCount = Math.max(0, total - (newCount + learningCount + reviewCount));

  let reviewWhere = "WHERE user_id = ?";
  let reviewParams: any[] = [userId];
  if (deckId !== undefined) {
    reviewWhere = "WHERE card_id IN (SELECT id FROM cards WHERE deck_id = ?) AND user_id = ?";
    reviewParams = [deckId, userId];
  }
  const totalReviewsResult = await db
    .prepare(`SELECT COUNT(*) as total FROM review_logs ${reviewWhere}`)
    .bind(...reviewParams)
    .first<{ total: number }>();

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayStartIso = todayStart.toISOString();

  let todayWhere = "WHERE reviewed_at >= ? AND user_id = ?";
  let todayParams: any[] = [todayStartIso, userId];
  if (deckId !== undefined) {
    todayWhere =
      "WHERE reviewed_at >= ? AND card_id IN (SELECT id FROM cards WHERE deck_id = ?) AND user_id = ?";
    todayParams = [todayStartIso, deckId, userId];
  }

  const todayReviewsResult = await db
    .prepare(`SELECT COUNT(*) as today FROM review_logs ${todayWhere}`)
    .bind(...todayParams)
    .first<{ today: number }>();

  return {
    total_cards: total,
    new_count: newCount,
    learning_count: learningCount,
    review_count: reviewCount,
    mastered_count: masteredCount,
    total_reviews: totalReviewsResult?.total || 0,
    reviews_today: todayReviewsResult?.today || 0,
    new_cards: newCount,
    learning_cards: learningCount,
    review_cards: reviewCount,
  };
}

app.get("/stats", async (c) => {
  const db = c.env.DB;
  const userId = getUserId(c);
  try {
    const mainStats = await aggregateStats(db, userId);

    const { results: decks } = await db
      .prepare("SELECT id, name FROM decks ORDER BY name")
      .all<{ id: number; name: string }>();
    const deckStatsList = [];

    for (const deck of decks) {
      const counts = await getDeckCounts(db, deck.id, userId);
      const studyReady = counts.new_count + counts.learning_count + counts.review_count;
      const mastered = Math.max(0, counts.total - studyReady);

      deckStatsList.push({
        id: deck.id,
        name: deck.name,
        card_count: counts.total,
        new_count: counts.new_count,
        learning_count: counts.learning_count,
        review_count: counts.review_count,
        mastered_count: mastered,
      });
    }

    return c.json({
      ...mainStats,
      decks: deckStatsList,
    });
  } catch (err: any) {
    return c.json({ error: `全体統計取得エラー: ${err.message}` }, 500);
  }
});

app.get("/stats/deck/:deckId", async (c) => {
  const db = c.env.DB;
  const userId = getUserId(c);
  const deckId = parseInt(c.req.param("deckId"), 10);
  try {
    const deckRow = await db
      .prepare("SELECT name FROM decks WHERE id = ?")
      .bind(deckId)
      .first<{ name: string }>();
    if (!deckRow) {
      return c.json({ error: "デッキが見つかりません" }, 404);
    }

    const deckStats = await aggregateStats(db, userId, deckId);

    return c.json({
      ...deckStats,
      deck_id: deckId,
      deck_name: deckRow.name,
    });
  } catch (err: any) {
    return c.json({ error: `デッキ別統計取得エラー: ${err.message}` }, 500);
  }
});

// 未定義ルート（静的アセットへのアクセス）をCloudflare Pagesにフォールスルー
app.notFound(async (c) => {
  const response = await c.env.ASSETS.fetch(c.req.raw);
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/html")) {
    const html = await response.text();
    const injected = html.replace(
      "</head>",
      `<script>window.__ANKI_TOKEN__ = "";</script></head>`
    );
    return new Response(injected, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
  return response;
});

export default app;