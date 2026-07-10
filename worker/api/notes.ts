/**
 * notes.ts - Anki互換ノートタイプ・カード生成ロジック (TypeScript版)
 *
 * 本モジュールは暗記カードアプリ「Anki」のコアメカニズムである
 * 「ノート（Note）」→「カード（Card）」の自動生成ロジックを実装する。
 *
 * 対応ノートタイプ:
 *   - Basic
 *   - Basic (and reversed card)
 *   - Basic (optional reversed card)
 *   - Basic (type in the answer)
 *   - Cloze
 *   - Image Occlusion
 *
 * 詳細仕様は docs/NOTE_TYPE_SPEC.md を参照。
 *
 * 依存: なし（純粋関数モジュール）
 * 参照元: parser.ts（Ankiファイルインポート時）
 */

// --- Cloze記法の正規表現パターン ---
const CLOZE_PATTERN = /\{\{c(\d+)::([^:}]+)(?:::(.*?[^\\]))?\}\}/g;

// --- ノートタイプ識別子（SSOT） ---
export const NOTE_TYPES = Object.freeze({
  BASIC: "Basic",
  BASIC_REVERSED: "Basic (and reversed card)",
  BASIC_OPTIONAL_REVERSED: "Basic (optional reversed card)",
  BASIC_TYPE_IN_ANSWER: "Basic (type in the answer)",
  CLOZE: "Cloze",
  IMAGE_OCCLUSION: "Image Occlusion",
});

// --- カード生成結果 ---

export interface CardPayload {
  /** ノートタイプ内のテンプレート番号（0-based） */
  templateIndex: number;
  /** Clozeの場合の対象インデックス */
  clozeIndex?: number;
  /** Clozeの最大数 */
  clozeCount?: number;
  /** 反転カードかどうか */
  isReversed?: boolean;
  /** Image OcclusionのアクティブマスクID */
  activeMaskId?: string;
}

export interface RenderedCard {
  /** 表面（表示用HTML） */
  front: string;
  /** 裏面（表示用HTML） */
  back: string;
  /** Clozeのインデックス */
  clozeIndex: number;
  /** Clozeの最大数 */
  clozeCount: number;
  /** 反転カードか */
  isReversed: boolean;
  /** テンプレート名 */
  templateName: string;
}

// --- フィールドマップ型 ---

export interface FieldMap {
  [key: string]: string;
}

// --- Cloze解析用正規表現の再エクスポート ---
// フロントエンド側でも同様のパターンを使うため公開
export { CLOZE_PATTERN };

// ==================================================================
// カード生成ロジック
// ==================================================================

/**
 * ノートタイプに応じてカードを展開し、レンダリング結果を返す。
 *
 * @param noteType - ノートタイプ名
 * @param fields  - フィールド名をキーとする値のマップ
 * @returns 生成されたカードの配列（front/back/clozeIndex等を含む）
 */
export function generateCards(noteType: string, fields: FieldMap): RenderedCard[] {
  switch (noteType) {
    case NOTE_TYPES.BASIC:
      return generateBasicCards(fields);
    case NOTE_TYPES.BASIC_REVERSED:
      return generateBasicReversedCards(fields);
    case NOTE_TYPES.BASIC_OPTIONAL_REVERSED:
      return generateBasicOptionalReversedCards(fields);
    case NOTE_TYPES.BASIC_TYPE_IN_ANSWER:
      return generateBasicTypeInAnswerCards(fields);
    case NOTE_TYPES.CLOZE:
      return generateClozeCards(fields);
    case NOTE_TYPES.IMAGE_OCCLUSION:
      return generateImageOcclusionCards(fields);
    default:
      // 未知のノートタイプは Basic として扱う（前方互換性）
      return generateBasicCards(fields);
  }
}

/**
 * テキスト内のCloze番号のセットを返す。
 */
export function countClozeNumbers(text: string): Set<number> {
  const numbers = new Set<number>();
  let match;
  const regex = new RegExp(CLOZE_PATTERN);
  while ((match = regex.exec(text)) !== null) {
    numbers.add(parseInt(match[1], 10));
  }
  return numbers;
}

// ==================================================================
// 各ノートタイプのカード生成実装
// ==================================================================

/**
 * Basic（基本）
 *
 * 想定フィールド: Front, Back
 * 生成カード数: 1枚
 * 条件: Front が空でない場合に生成
 */
function generateBasicCards(fields: FieldMap): RenderedCard[] {
  const front = (fields["Front"] || "").trim();
  if (!front) return [];

  const back = fields["Back"] || "";
  return [
    {
      front,
      back: back,
      clozeIndex: 0,
      clozeCount: 0,
      isReversed: false,
      templateName: "Card 1 (Front -> Back)",
    },
  ];
}

/**
 * Basic (and reversed card)（基本・両方向）
 *
 * 想定フィールド: Front, Back
 * 生成カード数: 最大2枚
 *
 * Card 1: Front が空でない場合に生成 (Front → Back)
 * Card 2: Back が空でない場合に生成 (Back → Front)
 */
function generateBasicReversedCards(fields: FieldMap): RenderedCard[] {
  const front = (fields["Front"] || "").trim();
  const back = (fields["Back"] || "").trim();
  const cards: RenderedCard[] = [];

  if (front) {
    cards.push({
      front,
      back: fields["Back"] || "",
      clozeIndex: 0,
      clozeCount: 0,
      isReversed: false,
      templateName: "Card 1 (Front -> Back)",
    });
  }

  if (back) {
    cards.push({
      front: back,
      back: front,
      clozeIndex: 0,
      clozeCount: 0,
      isReversed: true,
      templateName: "Card 2 (Back -> Front)",
    });
  }

  return cards;
}

/**
 * Basic (optional reversed card)（基本・逆方向カード選択可）
 *
 * 想定フィールド: Front, Back, Add Reverse
 * 生成カード数: 1枚 または 2枚
 *
 * Card 1: Front が空でない場合に生成
 * Card 2: Back が空でない かつ Add Reverse に値がある場合に生成
 */
function generateBasicOptionalReversedCards(fields: FieldMap): RenderedCard[] {
  const front = (fields["Front"] || "").trim();
  const back = (fields["Back"] || "").trim();
  const addReverse = (fields["Add Reverse"] || "").trim();
  const cards: RenderedCard[] = [];

  if (front) {
    cards.push({
      front,
      back: fields["Back"] || "",
      clozeIndex: 0,
      clozeCount: 0,
      isReversed: false,
      templateName: "Card 1 (Front -> Back)",
    });
  }

  // Add Reverse フィールドに何か値が入力されている場合のみ逆方向を生成
  if (addReverse && back) {
    cards.push({
      front: back,
      back: front,
      clozeIndex: 0,
      clozeCount: 0,
      isReversed: true,
      templateName: "Card 2 (Back -> Front)",
    });
  }

  return cards;
}

/**
 * Basic (type in the answer)（基本・解答入力）
 *
 * 想定フィールド: Front, Back
 * 生成カード数: 1枚
 *
 * 表面: Front + テキスト入力フォーム
 * 裏面: Front + ユーザー入力との差分表示 + Back
 *
 * NOTE: カード生成ロジックはBasicと同一。
 *       タイプインのUI差分（input type="text"表示、
 *       入力テキストと正解のDiffハイライト）はフロントエンドで実装する。
 *       テンプレート上は `{{type:Back}}` プレースホルダーで識別する。
 */
function generateBasicTypeInAnswerCards(fields: FieldMap): RenderedCard[] {
  // カード構造はBasicと同じ。フロントエンド側で type:Back の展開を行う。
  return generateBasicCards(fields);
}

/**
 * Cloze（穴埋め）
 *
 * 想定フィールド: Text, Back Extra
 * 生成カード数: Text内の一意なClozeインデックス数
 *
 * Text フィールドに含まれる {{c<番号>::<答え>::<ヒント>}} 記法を解析し、
 * 各インデックスごとに1枚のカードを生成する。
 *
 * 表面: 対象インデックスを [...]（ヒントがあれば [ヒント]）に置換。
 *        非対象インデックスは答えテキストで表示。
 * 裏面: 全Clozeの答えを展開し、対象インデックスの答えを強調表示。
 */
function generateClozeCards(fields: FieldMap): RenderedCard[] {
  const text = fields["Text"] || "";
  const backExtra = fields["Back Extra"] || "";

  const clozeNumbers = countClozeNumbers(text);
  if (clozeNumbers.size === 0) {
    // Cloze記法が存在しない場合、全体を表面として1枚生成
    if (!text.trim()) return [];
    return [
      {
        front: text,
        back: backExtra || text,
        clozeIndex: 0,
        clozeCount: 0,
        isReversed: false,
        templateName: "Cloze",
      },
    ];
  }

  const sortedNumbers = Array.from(clozeNumbers).sort((a, b) => a - b);
  return sortedNumbers.map((clozeNum) => ({
    front: renderClozeFront(text, clozeNum),
    back: renderClozeBack(text, clozeNum) + (backExtra ? `\n<hr id="answer">\n${backExtra}` : ""),
    clozeIndex: clozeNum,
    clozeCount: clozeNumbers.size,
    isReversed: false,
    templateName: `Cloze (c${clozeNum})`,
  }));
}

/**
 * Image Occlusion（画像目隠し）
 *
 * 想定フィールド: Image, Header, Footer, OcclusionData
 * 生成カード数: OcclusionData内の is_card が true のマスク数
 *
 * NOTE: カード生成時に front/back はプレースホルダーを保持し、
 *       実際の画像描画とマスクSVGレイヤーはフロントエンドで実装する。
 *       画面上でマスク位置が画像サイズの変更に追従するよう、
 *       SVG viewBox を使用したレスポンシブ対応を行う。
 */
function generateImageOcclusionCards(fields: FieldMap): RenderedCard[] {
  try {
    const imageUrl = fields["Image"] || "";
    const occlusionData = fields["OcclusionData"] || "[]";
    const masks: Array<{
      id: string;
      type: string;
      x: number;
      y: number;
      width: number;
      height: number;
      is_card: boolean;
    }> = JSON.parse(occlusionData);

    const cards: RenderedCard[] = [];
    masks.forEach((mask) => {
      if (mask.is_card) {
        // front: 画像URL, back: メタデータJSON（occlusionData + activeMaskId）
        cards.push({
          front: imageUrl,
          back: JSON.stringify({ occlusionData, activeMaskId: mask.id }),
          clozeIndex: 0,
          clozeCount: masks.filter((m) => m.is_card).length,
          isReversed: false,
          templateName: `Image Occlusion (${mask.id})`,
        });
      }
    });

    return cards;
  } catch {
    return [];
  }
}

// ==================================================================
// Cloze表示用レンダー関数
// ==================================================================

/**
 * Cloze問題の表面を生成する。
 * 対象インデックスを [...]（ヒントがあれば [ヒント]）に置換し、
 * 非対象インデックスは答えテキストで表示する。
 *
 * @param text - Cloze記法を含む元テキスト
 * @param targetIndex - 穴埋めにする対象のCloze番号
 * @returns プレーンテキスト
 */
function renderClozeFront(text: string, targetIndex: number): string {
  return text.replace(new RegExp(CLOZE_PATTERN), (match, p1, p2, p3) => {
    const clozeNum = parseInt(p1, 10);
    const answerText = p2;
    const hint = p3;

    if (clozeNum === targetIndex) {
      return hint ? `[${hint}]` : "[...]";
    }
    return answerText;
  });
}

/**
 * Cloze問題の裏面を生成する。
 * 全Clozeの答えを展開し、対象インデックスの答えを強調表示する。
 *
 * @param text - Cloze記法を含む元テキスト
 * @param targetIndex - ハイライトする対象のCloze番号
 * @returns HTML文字列（強調タグ付き）
 */
function renderClozeBack(text: string, targetIndex: number): string {
  return text.replace(new RegExp(CLOZE_PATTERN), (match, p1, p2) => {
    const clozeNum = parseInt(p1, 10);
    const answerText = p2;

    if (clozeNum === targetIndex) {
      return `<strong style="color: #1976D2;">${answerText}</strong>`;
    }
    return answerText;
  });
}
