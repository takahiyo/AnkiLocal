/**
 * parser.ts - Ankiテキストファイルパーサー (TypeScript版)
 *
 * backend/parser.py からの移植。
 * Ankiのエクスポート形式（タブ区切りテキスト）を解析し、カードデータを抽出する。
 * Cloze（穴埋め）記法の自動展開や、Basic (optional reversed card) の表裏逆転カード自動生成に対応。
 */

// --- Cloze記法の正規表現パターン ---
const CLOZE_PATTERN = /\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}/g;

// --- フィルタリング対象タグ ---
const FILTER_TAGS = new Set(["要削除"]);

/** ヘッダー情報を保持するインターフェース */
export interface ParsedHeader {
  separator: string;
  html: boolean;
  guidColumn: number;
  notetypeColumn: number;
  deckColumn: number;
  tagsColumn: number;
}

/** パース済みカードデータを保持するインターフェース */
export interface ParsedCard {
  guid: string;
  note_type: string;
  deck_name: string;
  front: string;
  back: string;
  tags: string;
  cloze_count: number;
  cloze_index: number;
  is_reversed: boolean;
}

/**
 * ヘッダー行（#で始まる行）をキーと値に分割する。
 */
function parseHeaderLine(line: string): [string, string] | null {
  if (!line.startsWith("#")) {
    return null;
  }
  const content = line.substring(1).trim();
  const colonIndex = content.indexOf(":");
  if (colonIndex !== -1) {
    const key = content.substring(0, colonIndex).trim().toLowerCase();
    const value = content.substring(colonIndex + 1).trim();
    return [key, value];
  }
  return [content.toLowerCase(), ""];
}

/**
 * ファイル先頭のヘッダー行群をパースする。
 */
export function parseHeaders(lines: string[]): { header: ParsedHeader; dataStart: number } {
  const header: ParsedHeader = {
    separator: "\t",
    html: true,
    guidColumn: 1,
    notetypeColumn: 2,
    deckColumn: 3,
    tagsColumn: 7,
  };
  let dataStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const result = parseHeaderLine(lines[i]);
    if (result === null) {
      dataStart = i;
      break;
    }
    const [key, value] = result;
    if (key === "separator" && value === "tab") {
      header.separator = "\t";
    } else if (key === "separator") {
      header.separator = value;
    } else if (key === "html") {
      header.html = value.toLowerCase() === "true";
    } else if (key === "guid column") {
      header.guidColumn = parseInt(value, 10);
    } else if (key === "notetype column") {
      header.notetypeColumn = parseInt(value, 10);
    } else if (key === "deck column") {
      header.deckColumn = parseInt(value, 10);
    } else if (key === "tags column") {
      header.tagsColumn = parseInt(value, 10);
    }
    dataStart = i + 1;
  }

  return { header, dataStart };
}

/**
 * タブ区切り行を解析する。引用符で囲まれたフィールドに対応。
 */
function splitTabWithQuotes(line: string, separator: string = "\t"): string[] {
  const fields: string[] = [];
  let current: string[] = [];
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    
    if (ch === '"' && !inQuotes) {
      inQuotes = true;
    } else if (ch === '"' && inQuotes) {
      // 次の文字を確認（エスケープされたダブルクォートか？）
      if (i + 1 < line.length && line[i + 1] === '"') {
        current.push('"');
        i++; // 1文字進める
      } else if (i + 1 >= line.length || line[i + 1] === separator) {
        inQuotes = false;
      } else {
        inQuotes = false;
        current.push(line[i + 1]);
        i++;
      }
    } else if (ch === separator && !inQuotes) {
      fields.push(current.join(""));
      current = [];
    } else {
      current.push(ch);
    }
  }
  
  fields.push(current.join(""));
  return fields;
}

/**
 * テキスト内のCloze番号のセットを返す。
 */
function countClozeNumbers(text: string): Set<number> {
  const numbers = new Set<number>();
  let match;
  // グローバル正規表現のため、新しく初期化してループを回す
  const regex = new RegExp(CLOZE_PATTERN);
  while ((match = regex.exec(text)) !== null) {
    numbers.add(parseInt(match[1], 10));
  }
  return numbers;
}

/**
 * Cloze問題の表面を生成する。
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
 */
function renderClozeBack(text: string, targetIndex: number): string {
  return text.replace(new RegExp(CLOZE_PATTERN), (match, p1, p2) => {
    const clozeNum = parseInt(p1, 10);
    const answerText = p2;
    
    if (clozeNum === targetIndex) {
      return `<strong>${answerText}</strong>`;
    }
    return answerText;
  });
}

/**
 * フィルタリング対象タグが含まれているか判定する。
 */
function hasFilterTags(tagsStr: string): boolean {
  if (!tagsStr.trim()) {
    return false;
  }
  const tagList = tagsStr.trim().split(/\s+/);
  return tagList.some((tag) => FILTER_TAGS.has(tag));
}

/**
 * データ行をパースする。
 */
export function parseDataLine(
  line: string,
  header: ParsedHeader
): [string, string, string, string, string, string] | null {
  if (!line.trim()) {
    return null;
  }

  const fields = splitTabWithQuotes(line, header.separator);

  const safeGet = (idx: number): string => {
    const zeroBased = idx - 1;
    if (zeroBased >= 0 && zeroBased < fields.length) {
      return fields[zeroBased];
    }
    return "";
  };

  const guid = safeGet(header.guidColumn);
  const noteType = safeGet(header.notetypeColumn);
  const deckName = safeGet(header.deckColumn);
  const tags = safeGet(header.tagsColumn);

  // フィールド4 と 5 を表・裏に使用（固定位置）
  const front = fields.length > 3 ? fields[3] : "";
  const back = fields.length > 4 ? fields[4] : "";

  if (!guid) {
    return null;
  }

  if (hasFilterTags(tags)) {
    return null;
  }

  return [guid, noteType, deckName, front, back, tags];
}

/**
 * ノートタイプに応じてカードを展開する。
 */
export function expandCards(
  guid: string,
  noteType: string,
  deckName: string,
  front: string,
  back: string,
  tags: string
): ParsedCard[] {
  const cards: ParsedCard[] = [];

  if (noteType === "Cloze") {
    const clozeNumbers = countClozeNumbers(front);
    if (clozeNumbers.size === 0) {
      cards.push({
        guid,
        note_type: noteType,
        deck_name: deckName,
        front,
        back: back || front,
        tags,
        cloze_count: 0,
        cloze_index: 0,
        is_reversed: false,
      });
    } else {
      const sortedNumbers = Array.from(clozeNumbers).sort((a, b) => a - b);
      for (const clozeNum of sortedNumbers) {
        const clozeFront = renderClozeFront(front, clozeNum);
        const clozeBack = renderClozeBack(front, clozeNum);
        cards.push({
          guid,
          note_type: noteType,
          deck_name: deckName,
          front: clozeFront,
          back: clozeBack,
          tags,
          cloze_count: clozeNumbers.size,
          cloze_index: clozeNum,
          is_reversed: false,
        });
      }
    }
  } else if (noteType === "Basic (optional reversed card)") {
    // 通常カード
    cards.push({
      guid,
      note_type: noteType,
      deck_name: deckName,
      front,
      back,
      tags,
      cloze_count: 0,
      cloze_index: 0,
      is_reversed: false,
    });
    // 逆カード (裏が存在する場合のみ)
    if (back.trim()) {
      cards.push({
        guid,
        note_type: noteType,
        deck_name: deckName,
        front: back,
        back: front,
        tags,
        cloze_count: 0,
        cloze_index: 0,
        is_reversed: true,
      });
    }
  } else {
    // Basic およびその他
    cards.push({
      guid,
      note_type: noteType,
      deck_name: deckName,
      front,
      back,
      tags,
      cloze_count: 0,
      cloze_index: 0,
      is_reversed: false,
    });
  }

  return cards;
}

/**
 * Ankiエクスポートファイルの全文をパースし、カードリストを返す。
 */
export function parseAnkiFile(content: string): ParsedCard[] {
  const lines = content.split(/\r?\n/);
  if (lines.length === 0) {
    return [];
  }

  const { header, dataStart } = parseHeaders(lines);
  const allCards: ParsedCard[] = [];

  for (let i = dataStart; i < lines.length; i++) {
    const parsed = parseDataLine(lines[i], header);
    if (parsed === null) {
      continue;
    }
    const [guid, noteType, deckName, front, back, tags] = parsed;
    const expanded = expandCards(guid, noteType, deckName, front, back, tags);
    allCards.push(...expanded);
  }

  return allCards;
}
