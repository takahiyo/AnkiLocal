import { Hono } from "hono";
import { parseAnkiFile } from "./api/parser";
import { calculateNextReview, Rating } from "./api/srs";

type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
};

const app = new Hono<{ Bindings: Bindings }>().basePath("/api");

// 未定義ルート（静的アセットへのアクセス）をCloudflare Pagesにフォールスルーする
app.notFound(async (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

// --- トークン認証ミドルウェア ---
app.use("*", async (c, next) => {
  // 環境変数 ACCESS_TOKEN を参照、設定されていない場合はデフォルト値を使用
  const expectedToken = (c.env as any).ACCESS_TOKEN || "ankilocal-secret";
  
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

  await next();
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

      result.push({
        id: deck.id,
        name: deck.name,
        created_at: deck.created_at,
        // フロントエンドJS (deck-list.js) が直接読み込むフラットなプロパティ
        card_count: counts.total,
        new_count: counts.new_count,
        learning_count: counts.learning_count,
        review_count: counts.review_count,
        // バックエンドモデル互換のネストされたプロパティ
        card_counts: {
          total: counts.total,
          new: counts.new_count,
          learning: counts.learning_count,
          review: counts.review_count,
        },
      });
    }

    return c.json(result);
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
    let cardsCreated = 0;
    let skipped = 0;
    const uniqueNotes = new Set<string>();

    for (const card of parsedCards) {
      uniqueNotes.add(card.guid);

      // デッキの取得または作成
      if (!deckCache[card.deck_name]) {
        const existingDeck = await db
          .prepare("SELECT id FROM decks WHERE name = ?")
          .bind(card.deck_name)
          .first<{ id: number }>();

        if (existingDeck) {
          deckCache[card.deck_name] = existingDeck.id;
        } else {
          const insertDeck = await db
            .prepare("INSERT INTO decks (name) VALUES (?)")
            .bind(card.deck_name)
            .run();
          
          const newId = insertDeck.meta.last_row_id;
          deckCache[card.deck_name] = newId;
          decksCreated.push(card.deck_name);
        }
      }

      const deckId = deckCache[card.deck_name];

      // カードの挿入 (重複はスキップ)
      try {
        const insertCard = await db
          .prepare(
            `INSERT INTO cards (guid, deck_id, note_type, front, back, tags, cloze_count, cloze_index, is_reversed)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            card.guid,
            deckId,
            card.note_type,
            card.front,
            card.back,
            card.tags,
            card.cloze_count,
            card.cloze_index,
            card.is_reversed ? 1 : 0
          )
          .run();

        const cardId = insertCard.meta.last_row_id;

        // card_statesの初期レコード作成
        await db.prepare("INSERT INTO card_states (card_id) VALUES (?)").bind(cardId).run();
        cardsCreated++;
      } catch (err: any) {
        // UNIQUE制約違反時は重複としてスキップ
        console.error("Card insert error:", err);
        skipped++;
      }
    }

    // フロントエンド (import.js) の求めるレスポンス形式にマッピング
    const importedDecks = await Promise.all(
      decksCreated.map(async (name) => {
        const deckRow = await db.prepare("SELECT id FROM decks WHERE name = ?").bind(name).first<{ id: number }>();
        const counts = deckRow ? await getDeckCounts(db, deckRow.id) : { total: 0 };
        return { name, card_count: counts.total };
      })
    );

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

/**
 * GET: 学習対象カードの取得
 */
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

    // 1. new カード
    const { results: newCards } = await db
      .prepare(
        `SELECT c.*, cs.ease_factor, cs.interval_days, cs.repetitions, cs.status, cs.next_review_at
         FROM cards c
         JOIN card_states cs ON c.id = cs.card_id
         WHERE c.deck_id = ? AND cs.status = 'new'
         ORDER BY c.id
         LIMIT ?`
      )
      .bind(deckId, batchSize)
      .all();
    cards.push(...newCards);

    // 2. learning カード
    if (cards.length < batchSize) {
      const remaining = batchSize - cards.length;
      const { results: learningCards } = await db
        .prepare(
          `SELECT c.*, cs.ease_factor, cs.interval_days, cs.repetitions, cs.status, cs.next_review_at
           FROM cards c
           JOIN card_states cs ON c.id = cs.card_id
           WHERE c.deck_id = ? AND cs.status = 'learning'
             AND (cs.next_review_at IS NULL OR cs.next_review_at <= ?)
           ORDER BY cs.next_review_at
           LIMIT ?`
        )
        .bind(deckId, nowIso, remaining)
        .all();
      cards.push(...learningCards);
    }

    // 3. review カード (復習期限到来)
    if (cards.length < batchSize) {
      const remaining = batchSize - cards.length;
      const { results: reviewCards } = await db
        .prepare(
          `SELECT c.*, cs.ease_factor, cs.interval_days, cs.repetitions, cs.status, cs.next_review_at
           FROM cards c
           JOIN card_states cs ON c.id = cs.card_id
           WHERE c.deck_id = ? AND cs.status = 'review'
             AND cs.next_review_at <= ?
           ORDER BY cs.next_review_at
           LIMIT ?`
        )
        .bind(deckId, nowIso, remaining)
        .all();
      cards.push(...reviewCards);
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
      .prepare("SELECT ease_factor, interval_days, repetitions, status FROM card_states WHERE card_id = ?")
      .bind(cardId)
      .first<{ ease_factor: number; interval_days: number; repetitions: number; status: string }>();

    if (!stateRow) {
      return c.json({ error: "カードが見つかりません" }, 404);
    }

    const result = calculateNextReview(
      {
        easeFactor: stateRow.ease_factor,
        intervalDays: stateRow.interval_days,
        repetitions: stateRow.repetitions,
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
         SET ease_factor = ?, interval_days = ?, repetitions = ?,
             next_review_at = ?, last_reviewed_at = ?, status = ?
         WHERE card_id = ?`
      ).bind(
        result.easeFactor,
        result.intervalDays,
        result.repetitions,
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
