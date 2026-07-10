/**
 * parser.ts - Ankiテキストファイルパーサー (TypeScript版)
 *
 * Ankiのエクスポート形式（タブ区切りテキスト）を解析し、カードデータを抽出する。
 * ノートタイプ別カード生成ロジックは notes.ts に委譲する。
 *
 * 依存: api/notes.ts
 * 参照元: index.ts (POST /api/import)
 */

import { generateCards, NOTE_TYPES } from "./notes";

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
 * ノートタイプに応じて、Ankiのフィールド位置（0-based index 3〜）を
 * notes.ts の FieldMap にマッピングする。
 *
 * Ankiテキストファイルのレイアウト:
 *   フィールド0: guid
 *   フィールド1: noteType
 *   フィールド2: deckName
 *   フィールド3+: ノートタイプ依存のデータフィールド
 *   最終フィールド: tags
 */
function buildFieldMap(noteType: string, fields: string[]): Record<string, string> {
  const safeGet = (idx: number): string => {
    if (idx >= 0 && idx < fields.length) return fields[idx];
    return "";
  };

  switch (noteType) {
    case NOTE_TYPES.CLOZE:
      return {
        "Text": safeGet(3),
        "Back Extra": safeGet(4),
      };
    case NOTE_TYPES.BASIC_OPTIONAL_REVERSED:
      return {
        "Front": safeGet(3),
        "Back": safeGet(4),
        "Add Reverse": safeGet(5),
      };
    case NOTE_TYPES.IMAGE_OCCLUSION:
      return {
        "Image": safeGet(3),
        "Header": safeGet(4),
        "Footer": safeGet(5),
        "OcclusionData": safeGet(6),
      };
    // Basic, Basic (and reversed card), Basic (type in the answer) は同構造
    case NOTE_TYPES.BASIC:
    case NOTE_TYPES.BASIC_REVERSED:
    case NOTE_TYPES.BASIC_TYPE_IN_ANSWER:
    default:
      return {
        "Front": safeGet(3),
        "Back": safeGet(4),
      };
  }
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
 * 戻り値: [guid, noteType, deckName, front, back, field5, tags]
 *   field5: Add Reverse（optional reversed card）または Footer（Image Occlusion）
 */
export function parseDataLine(
  line: string,
  header: ParsedHeader
): [string, string, string, string, string, string, string] | null {
  if (!line.trim()) {
    return null;
  }

  const fields = splitTabWithQuotes(line, header.separator);

  const safeGetCol = (col: number): string => {
    const idx = col - 1;
    return (idx >= 0 && idx < fields.length) ? fields[idx] : "";
  };

  const guid = safeGetCol(header.guidColumn);
  const noteType = safeGetCol(header.notetypeColumn);
  const deckName = safeGetCol(header.deckColumn);
  const tags = safeGetCol(header.tagsColumn);

  // データフィールドは固定位置（0-based index 3, 4, 5）
  // Ankiエクスポート: guid, noteType, deck, dataField1, dataField2, dataField3, tags
  const front = fields.length > 3 ? fields[3] : "";
  const back = fields.length > 4 ? fields[4] : "";
  const field5 = fields.length > 5 ? fields[5] : "";

  if (!guid) {
    return null;
  }

  if (hasFilterTags(tags)) {
    return null;
  }

  return [guid, noteType, deckName, front, back, field5, tags];
}

/**
 * ノートタイプに応じてカードを展開する。
 * カード生成ロジックは notes.ts の generateCards() に委譲する。
 */
export function expandCards(
  guid: string,
  noteType: string,
  deckName: string,
  front: string,
  back: string,
  field5: string,
  tags: string
): ParsedCard[] {
  // フィールド配列を構築: [guid, noteType, deckName, field3, field4, field5]
  const fieldsArr = [guid, noteType, deckName, front, back, field5];
  const fieldMap = buildFieldMap(noteType, fieldsArr);

  const renderedCards = generateCards(noteType, fieldMap);

  return renderedCards.map((rc) => ({
    guid,
    note_type: noteType,
    deck_name: deckName,
    front: rc.front,
    back: rc.back,
    tags,
    cloze_count: rc.clozeCount,
    cloze_index: rc.clozeIndex,
    is_reversed: rc.isReversed,
  }));
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
    const [guid, noteType, deckName, front, back, field5, tags] = parsed;
    const expanded = expandCards(guid, noteType, deckName, front, back, field5, tags);
    allCards.push(...expanded);
  }

  return allCards;
}
