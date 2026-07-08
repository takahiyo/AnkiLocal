import { Hono } from "hono";
import { parseAnkiFile } from "./api/parser";
import { calculateNextReview, Rating } from "./api/srs";

type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
};

const app = new Hono<{ Bindings: Bindings }>().basePath("/api");

// --- トークン認証ミドルウェア ---
app.use("*", async (c, next) => {
  // 環境変数 ACCESS_TOKEN を参照、設定されていない場合はデフォルト値を使用
  const expectedToken = (c.env as any).ACCESS_TOKEN || "ankilocal-secret";

  // APIルート（/api/で始まるパス）のみトークン認証を実施
  const url = new URL(c.req.url);
  if (url.pathname.startsWith("/api/")) {
    let token = c.req.query("token");
    if (!token) {
      const authHeader = c.req.header("Authorization");
      if (authHeader && authHeader.startsWith("Bearer ")) {
        token = authHeader.substring(7);
      }
    }

    if (token !== expectedToken) {
      return c.json({ error: "認証エラー: 無効なトークンです" }, 401);
    }
  }

  // 自動マイグレーション (lapsesカラムの追加等)
  try {
    await c.env.DB.prepare("ALTER TABLE card_states ADD COLUMN lapses INTEGER NOT NULL DEFAULT 0").run();
  } catch (e) {}

  try {
    await c.env.DB.prepare("ALTER TABLE deck_options ADD COLUMN excluded_tags TEXT NOT NULL DEFAULT ''").run();
  } catch (e) {}

  try {
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS deck_options (
          deck_id          INTEGER PRIMARY KEY,
          max_new_cards    INTEGER NOT NULL DEFAULT 20,
          max_review_cards INTEGER NOT NULL DEFAULT 100,
          review_order     TEXT NOT NULL DEFAULT 'random',
          excluded_tags    TEXT NOT NULL DEFAULT '',
          FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE
      )
    `).run();
  } catch (e) {}

  await next();
});

// 未定義ルート（静的アセットへのアクセス）をCloudflare Pagesにフォールスルーし、
// HTMLレスポンスには認証トークンを埋め込む
app.notFound(async (c) => {
  const response = await c.env.ASSETS.fetch(c.req.raw);
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/html")) {
    const token = (c.env as any).ACCESS_TOKEN || "ankilocal-secret";
    const html = await response.text();
    const injected = html.replace(
      "</head>",
      `<script>window.__ANKI_TOKEN__ = "${token}";</script></head>`
    );
    return new Response(injected, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
  return response;
});

// --- APIレスポンス用のヘルパー関数 ---

/**
 * デッキごとのカード内訳を集計する
 */
async function getDeckCounts(db: D1Database, deckId: number) {
  const query = `
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN cs.status = 'new' OR cs.status IS NULL THEN 1 ELSE 0 END) as new_count,
      SUM(CASE WHEN cs.status = 'learning' THEN 1 ELSE 0 END) as learning_count,
      SUM(CASE WHEN cs.status = 'review' THEN 1 ELSE 0 END) as review_count
    FROM cards c
    LEFT JOIN card_states cs ON c.id = cs.card_id
    WHERE c.deck_id = ?
  `;
  const result = await db.prepare(query).bind(deckId).first<{
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

/**
 * 除外タグを考慮したカード数を取得する
 */
async function getStudyableCount(db: D1Database, deckId: number, excludedTags: string) {
  const tagList = excludedTags ? excludedTags.trim().split(/\s+/).filter(Boolean) : [];
  if (tagList.length === 0) {
    const counts = await getDeckCounts(db, deckId);
    return counts.total;
  }

  // 全タグが除外されている場合は0
  const { results: allRows } = await db
    .prepare("SELECT tags FROM cards WHERE deck_id = ? AND tags != ''")
    .bind(deckId)
    .all<{ tags: string }>();
  const uniqueTags = new Set<string>();
  for (const row of allRows) {
    for (const tag of row.tags.trim().split(/\s+/)) {
      if (tag) uniqueTags.add(tag);
    }
  }
  if (uniqueTags.size > 0 && tagList.length >= uniqueTags.size) return 0;

  const conditions = tagList.map(() => `INSTR(' ' || c.tags || ' ', ?) = 0`);
  const params: any[] = tagList.map(t => ` ${t} `);
  const result = await db.prepare(`
    SELECT COUNT(*) as total FROM cards c
    WHERE c.deck_id = ? AND (c.tags = '' OR (${conditions.join(' AND ')}))
  `).bind(deckId, ...params).first<{ total: number }>();
  return result?.total || 0;
}

// --- ルーティング定義 ---

/**
 * GET: デッキ一覧取得
 */
app.get("/decks", async (c) => {
  const db = c.env.DB;
  try {
    const { results: decks } = await db
      .prepare("SELECT id, name, created_at FROM decks ORDER BY name")
      .all<{ id: number; name: string; created_at: string }>();

    const result = [];
    for (const deck of decks) {
      const counts = await getDeckCounts(db, deck.id);

      // オプション取得（日次タスク上限＋除外タグ）
      const options = await db
        .prepare("SELECT max_new_cards, max_review_cards, excluded_tags FROM deck_options WHERE deck_id = ?")
        .bind(deck.id)
        .first<{ max_new_cards: number; max_review_cards: number; excluded_tags: string }>();
      const dailyTaskLimit = (options?.max_new_cards || 20) + (options?.max_review_cards || 100);

      // 除外タグ考慮の出題可能カード数
      const studyableCount = await getStudyableCount(db, deck.id, options?.excluded_tags || '');

      // 今日の復習数
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);
      const todayResult = await db
        .prepare(
          `SELECT COUNT(*) as today FROM review_logs
           WHERE reviewed_at >= ? AND card_id IN (SELECT id FROM cards WHERE deck_id = ?)`
        )
        .bind(todayStart.toISOString(), deck.id)
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

    return c.json(result, 200, { 'Cache-Control': 'no-store, no-cache, must-revalidate' });
  } catch (err: any) {
    return c.json({ error: `デッキ一覧取得エラー: ${err.message}` }, 500);
  }
});

/**
 * POST: デッキテキストファイルのインポート
 */
app.post("/import", async (c) => {
  const db = c.env.DB;
  try {
    const formData = await c.req.raw.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return c.json({ error: "ファイルがアップロードされていません" }, 400);
    }

    const raw = await file.arrayBuffer();
    const decoder = new TextDecoder("utf-8");
    const content = decoder.decode(raw);

    const parsedCards = parseAnkiFile(content);
    if (parsedCards.length === 0) {
      return c.json({
        success: false,
        message: "カードが見つかりませんでした。ファイル形式を確認してください。",
      });
    }

    // デッキ名 -> IDのキャッシュ
    const deckCache: Record<string, number> = {};
    const decksCreated: string[] = [];
    const uniqueNotes = new Set<string>();
    
    const uniqueDeckNames = Array.from(new Set(parsedCards.map(c => c.deck_name)));

    // 1. 既存デッキの取得
    const existingDecks = await db.prepare("SELECT id, name FROM decks").all<{ id: number, name: string }>();
    for (const d of existingDecks.results) {
      deckCache[d.name] = d.id;
    }

    // 2. 不足しているデッキをマルチ行INSERTで作成
    const missingDecks = uniqueDeckNames.filter(name => !deckCache[name]);
    if (missingDecks.length > 0) {
      const deckPlaceholders = missingDecks.map(() => "(?)").join(", ");
      await db.prepare(`INSERT OR IGNORE INTO decks (name) VALUES ${deckPlaceholders}`).bind(...missingDecks).run();
      
      // 作成したデッキのIDを再取得
      const newDecks = await db.prepare("SELECT id, name FROM decks").all<{ id: number, name: string }>();
      for (const d of newDecks.results) {
        deckCache[d.name] = d.id;
        if (missingDecks.includes(d.name)) {
          decksCreated.push(d.name);
        }
      }
    }

    let cardsCreated = 0;
    
    // 3. マルチ行INSERTステートメントを準備（10件ずつ = 90バインド変数でD1上限を回避）
    //    全ステートメントを db.batch() で一括送信し、サブリクエストを1回に抑える
    const BATCH_SIZE = 10;
    const insertStmts: ReturnType<typeof db.prepare>[] = [];
    
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
      
      insertStmts.push(
        db.prepare(
          `INSERT OR IGNORE INTO cards (guid, deck_id, note_type, front, back, tags, cloze_count, cloze_index, is_reversed) VALUES ${placeholders}`
        ).bind(...params)
      );
    }
    
    // card_states の一括作成もバッチに含める
    insertStmts.push(
      db.prepare("INSERT OR IGNORE INTO card_states (card_id) SELECT id FROM cards")
    );
    
    // 全ステートメントを1回のバッチ（=1サブリクエスト）で実行
    const batchResults = await db.batch(insertStmts);
    // 最後の1つは card_states なので除外してカウント
    for (let r = 0; r < batchResults.length - 1; r++) {
      if (batchResults[r].meta && batchResults[r].meta.changes) {
        cardsCreated += batchResults[r].meta.changes;
      }
    }

    const skipped = parsedCards.length - cardsCreated;

    // 5. デッキごとのカード数を一括取得（サブリクエスト節約）
    const { results: deckCountRows } = await db.prepare(`
      SELECT c.deck_id, COUNT(*) as total
      FROM cards c
      WHERE c.deck_id IN (${uniqueDeckNames.map(() => '?').join(',')})
      GROUP BY c.deck_id
    `).bind(...uniqueDeckNames.map(n => deckCache[n])).all<{ deck_id: number; total: number }>();
    
    const deckCountMap: Record<number, number> = {};
    for (const row of deckCountRows) {
      deckCountMap[row.deck_id] = row.total;
    }
    
    const importedDecks = uniqueDeckNames.map(name => ({
      name,
      card_count: deckCountMap[deckCache[name]] || 0,
    }));

    return c.json({
      success: true,
      message: `インポート完了: ${cardsCreated}枚のカードを作成しました。`,
      imported_count: cardsCreated,
      skipped_count: skipped,
      total_notes_parsed: uniqueNotes.size,
      total_cards_created: cardsCreated,
      decks_created: decksCreated,
      skipped_existing: skipped,
      decks: importedDecks,
    });
  } catch (err: any) {
    console.error("Import error:", err.stack || err);
    return c.json({ error: `インポートエラー: ${err.message}` }, 500);
  }
});

// ==========================================
// 6. デッキオプション (Options)
// ==========================================

// デッキオプション取得
app.get("/decks/:deckId/options", async (c) => {
  const db: D1Database = c.env.DB;
  const deckIdStr = c.req.param("deckId");
  const deckId = parseInt(deckIdStr, 10);

  if (isNaN(deckId)) return c.json({ error: "無効なデッキIDです" }, 400);

  let options = await db
    .prepare("SELECT max_new_cards, max_review_cards, review_order, excluded_tags FROM deck_options WHERE deck_id = ?")
    .bind(deckId)
    .first<{ max_new_cards: number; max_review_cards: number; review_order: string; excluded_tags: string }>();

  if (!options) {
    options = {
      max_new_cards: 20,
      max_review_cards: 100,
      review_order: 'random',
      excluded_tags: ''
    };
  }

  return c.json(options);
});

// デッキオプション更新
app.post("/decks/:deckId/options", async (c) => {
  const db: D1Database = c.env.DB;
  const deckIdStr = c.req.param("deckId");
  const deckId = parseInt(deckIdStr, 10);

  if (isNaN(deckId)) return c.json({ error: "無効なデッキIDです" }, 400);

  const body = await c.req.json();
  const maxNew = typeof body.max_new_cards === 'number' ? body.max_new_cards : 20;
  const maxRev = typeof body.max_review_cards === 'number' ? body.max_review_cards : 100;
  const order = body.review_order === 'sequential' ? 'sequential' : 'random';
  const excludedTags = typeof body.excluded_tags === 'string' ? body.excluded_tags : '';

  await db.prepare(`
    INSERT INTO deck_options (deck_id, max_new_cards, max_review_cards, review_order, excluded_tags)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(deck_id) DO UPDATE SET
      max_new_cards = excluded.max_new_cards,
      max_review_cards = excluded.max_review_cards,
      review_order = excluded.review_order,
      excluded_tags = excluded.excluded_tags
  `).bind(deckId, maxNew, maxRev, order, excludedTags).run();

  return c.json({ success: true });
});

// ==========================================
// 7. デッキ内タグ一覧
// ==========================================

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

// ==========================================
// 8. 出題 (Study)
// ==========================================

app.get("/decks/:deckId/study", async (c) => {
  const db = c.env.DB;
  const deckId = parseInt(c.req.param("deckId"), 10);

  try {
    // デッキ存在確認
    const deckExists = await db.prepare("SELECT id FROM decks WHERE id = ?").bind(deckId).first();
    if (!deckExists) {
      return c.json({ error: "デッキが見つかりません" }, 404);
    }

    const nowIso = new Date().toISOString();
    const batchSize = 20; // STUDY_BATCH_SIZE

    const cards: any[] = [];

    let options = await db.prepare("SELECT max_new_cards, max_review_cards, review_order, excluded_tags FROM deck_options WHERE deck_id = ?").bind(deckId).first<{max_new_cards: number, max_review_cards: number, review_order: string, excluded_tags: string}>();
    if (!options) {
      options = { max_new_cards: 20, max_review_cards: 100, review_order: 'random', excluded_tags: '' };
    }

    // 除外タグ条件を構築
    const excludedTagList = options.excluded_tags ? options.excluded_tags.trim().split(/\s+/).filter(Boolean) : [];
    let tagFilterSql = '';
    const tagFilterParams: any[] = [];
    if (excludedTagList.length > 0) {
      const conditions = excludedTagList.map(() => `INSTR(' ' || c.tags || ' ', ?) = 0`);
      tagFilterParams.push(...excludedTagList.map(t => ` ${t} `));
      tagFilterSql = ` AND (c.tags = '' OR (${conditions.join(' AND ')}))`;
    }

    // 1. new カード
    const newBatchSize = options.max_new_cards;
    if (newBatchSize > 0) {
      const { results: newCards } = await db
        .prepare(
          `SELECT c.*, cs.ease_factor, cs.interval_days, cs.repetitions, cs.lapses, cs.status, cs.next_review_at
           FROM cards c
           JOIN card_states cs ON c.id = cs.card_id
           WHERE c.deck_id = ? AND cs.status = 'new'${tagFilterSql}
           ORDER BY c.id
           LIMIT ?`
        )
        .bind(deckId, ...tagFilterParams, newBatchSize)
        .all();
      cards.push(...newCards);
    }

    // 2. review / learning カード
    const reviewBatchSize = options.max_review_cards;
    if (reviewBatchSize > 0) {
      const { results: reviewCards } = await db
        .prepare(
          `SELECT c.*, cs.ease_factor, cs.interval_days, cs.repetitions, cs.lapses, cs.status, cs.next_review_at
           FROM cards c
           JOIN card_states cs ON c.id = cs.card_id
           WHERE c.deck_id = ? AND cs.status IN ('learning', 'review')
             AND (cs.next_review_at IS NULL OR cs.next_review_at <= ?)${tagFilterSql}
           ORDER BY cs.next_review_at
           LIMIT ?`
        )
        .bind(deckId, nowIso, ...tagFilterParams, reviewBatchSize)
        .all();
      cards.push(...reviewCards);
    }

    // シャッフルまたは順次並び替え
    if (options.review_order === 'random') {
      for (let i = cards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cards[i], cards[j]] = [cards[j], cards[i]];
      }
    }

    // レスポンスマッピング
    return c.json(
      cards.map((row) => ({
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
      }))
    );
  } catch (err: any) {
    return c.json({ error: `学習カード取得エラー: ${err.message}` }, 500);
  }
});

/**
 * POST: 復習結果の登録
 */
app.post("/cards/:cardId/review", async (c) => {
  const db = c.env.DB;
  const cardId = parseInt(c.req.param("cardId"), 10);
  
  try {
    const { rating } = await c.req.json<{ rating: number }>();

    if (!rating || rating < 1 || rating > 4) {
      return c.json({ error: "不正な評価値です (1-4)" }, 400);
    }

    const stateRow = await db
      .prepare("SELECT ease_factor, interval_days, repetitions, lapses, status FROM card_states WHERE card_id = ?")
      .bind(cardId)
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

    // トランザクション的に更新を実行
    await db.batch([
      db.prepare(
        `UPDATE card_states
         SET ease_factor = ?, interval_days = ?, repetitions = ?, lapses = ?,
             next_review_at = ?, last_reviewed_at = ?, status = ?
         WHERE card_id = ?`
      ).bind(
        result.easeFactor,
        result.intervalDays,
        result.repetitions,
        result.lapses,
        nextReviewIso,
        nowIso,
        result.status,
        cardId
      ),
      db.prepare("INSERT INTO review_logs (card_id, rating, reviewed_at) VALUES (?, ?, ?)").bind(cardId, rating, nowIso)
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

/**
 * 統計情報の共通集計処理
 */
async function aggregateStats(db: D1Database, deckId?: number) {
  let cardWhere = "";
  let cardParams: any[] = [];
  if (deckId !== undefined) {
    cardWhere = "WHERE c.deck_id = ?";
    cardParams = [deckId];
  }

  // 各種ステータスカード数のカウント
  const countsQuery = `
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN cs.status = 'new' OR cs.status IS NULL THEN 1 ELSE 0 END) as new_count,
      SUM(CASE WHEN cs.status = 'learning' THEN 1 ELSE 0 END) as learning_count,
      SUM(CASE WHEN cs.status = 'review' THEN 1 ELSE 0 END) as review_count
    FROM cards c
    LEFT JOIN card_states cs ON c.id = cs.card_id
    ${cardWhere}
  `;
  const counts = await db.prepare(countsQuery).bind(...cardParams).first<{
    total: number;
    new_count: number;
    learning_count: number;
    review_count: number;
  }>();

  const total = counts?.total || 0;
  const newCount = counts?.new_count || 0;
  const learningCount = counts?.learning_count || 0;
  const reviewCount = counts?.review_count || 0;
  // 習得済み: 全体 - 未着手 - 学習中 - 復習待ち
  const masteredCount = Math.max(0, total - (newCount + learningCount + reviewCount));

  // 復習ログ総数
  let reviewWhere = "";
  let reviewParams: any[] = [];
  if (deckId !== undefined) {
    reviewWhere = "WHERE card_id IN (SELECT id FROM cards WHERE deck_id = ?)";
    reviewParams = [deckId];
  }
  const totalReviewsResult = await db
    .prepare(`SELECT COUNT(*) as total FROM review_logs ${reviewWhere}`)
    .bind(...reviewParams)
    .first<{ total: number }>();

  // 今日の復習数 (UTC基準の本日0時以降)
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayStartIso = todayStart.toISOString();
  
  let todayWhere = "WHERE reviewed_at >= ?";
  let todayParams: any[] = [todayStartIso];
  if (deckId !== undefined) {
    todayWhere = "WHERE reviewed_at >= ? AND card_id IN (SELECT id FROM cards WHERE deck_id = ?)";
    todayParams = [todayStartIso, deckId];
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
    
    // バックエンド/models.pyのフィールド名互換
    new_cards: newCount,
    learning_cards: learningCount,
    review_cards: reviewCount,
  };
}

/**
 * GET: 全体統計
 */
app.get("/stats", async (c) => {
  const db = c.env.DB;
  try {
    const mainStats = await aggregateStats(db);

    // デッキ別の統計リストも返す (stats.js がテーブル描画で使用する)
    const { results: decks } = await db.prepare("SELECT id, name FROM decks ORDER BY name").all<{ id: number; name: string }>();
    const deckStatsList = [];

    for (const deck of decks) {
      const counts = await getDeckCounts(db, deck.id);
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

/**
 * GET: デッキ別統計
 */
app.get("/stats/deck/:deckId", async (c) => {
  const db = c.env.DB;
  const deckId = parseInt(c.req.param("deckId"), 10);
  try {
    const deckRow = await db.prepare("SELECT name FROM decks WHERE id = ?").bind(deckId).first<{ name: string }>();
    if (!deckRow) {
      return c.json({ error: "デッキが見つかりません" }, 404);
    }

    const deckStats = await aggregateStats(db, deckId);

    return c.json({
      ...deckStats,
      deck_id: deckId,
      deck_name: deckRow.name,
    });
  } catch (err: any) {
    return c.json({ error: `デッキ別統計取得エラー: ${err.message}` }, 500);
  }
});

export default app;
