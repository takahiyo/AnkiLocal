# ============================================================
# parser.py - Ankiテキストファイルパーサー
# ============================================================
# Ankiのエクスポート形式（タブ区切りテキスト）を解析し、
# カードデータを抽出する。
# ヘッダー行の解析、引用符エスケープ対応、
# Cloze記法の検出・展開、reversedカードの生成を行う。
# ============================================================

import re
from dataclasses import dataclass, field
from typing import Optional

# --- Cloze記法の正規表現パターン ---
_CLOZE_PATTERN = re.compile(r"\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}")

# --- フィルタリング対象タグ ---
_FILTER_TAGS = frozenset({"要削除"})


@dataclass
class ParsedHeader:
    """ヘッダー情報を保持するデータクラス"""
    separator: str = "\t"
    html: bool = True
    guid_column: int = 1
    notetype_column: int = 2
    deck_column: int = 3
    tags_column: int = 7


@dataclass
class ParsedCard:
    """パース済みカードデータを保持するデータクラス"""
    guid: str = ""
    note_type: str = ""
    deck_name: str = ""
    front: str = ""
    back: str = ""
    tags: str = ""
    cloze_count: int = 0
    cloze_index: int = 0
    is_reversed: bool = False


def parse_header_line(line: str) -> Optional[tuple[str, str]]:
    """
    ヘッダー行（#で始まる行）をキーと値に分割する。

    Returns:
        (キー, 値) のタプル。ヘッダー行でない場合はNone。
    """
    if not line.startswith("#"):
        return None
    # '#' を除去してキーと値を分割
    content = line[1:].strip()
    if ":" in content:
        key, value = content.split(":", 1)
        return key.strip().lower(), value.strip()
    return content.strip().lower(), ""


def parse_headers(lines: list[str]) -> tuple[ParsedHeader, int]:
    """
    ファイル先頭のヘッダー行群をパースする。

    Returns:
        (ParsedHeader, データ開始行のインデックス)
    """
    header = ParsedHeader()
    data_start = 0

    for i, line in enumerate(lines):
        result = parse_header_line(line)
        if result is None:
            data_start = i
            break
        key, value = result
        if key == "separator" and value == "tab":
            header.separator = "\t"
        elif key == "separator":
            header.separator = value
        elif key == "html":
            header.html = value.lower() == "true"
        elif key == "guid column":
            header.guid_column = int(value)
        elif key == "notetype column":
            header.notetype_column = int(value)
        elif key == "deck column":
            header.deck_column = int(value)
        elif key == "tags column":
            header.tags_column = int(value)
        data_start = i + 1

    return header, data_start


def _split_tab_with_quotes(line: str, separator: str = "\t") -> list[str]:
    """
    タブ区切り行を解析する。引用符で囲まれたフィールドに対応。

    Ankiのエクスポートでは、フィールド内にタブやダブルクォートが
    含まれる場合に引用符でエスケープされる。
    """
    fields: list[str] = []
    current = []
    in_quotes = False
    chars = iter(line)

    for ch in chars:
        if ch == '"' and not in_quotes:
            # 引用符開始
            in_quotes = True
        elif ch == '"' and in_quotes:
            # 次の文字を確認（エスケープされたダブルクォートか？）
            next_ch = next(chars, None)
            if next_ch == '"':
                # "" → リテラルの "
                current.append('"')
            elif next_ch == separator or next_ch is None:
                # 引用符終了 → フィールド終了
                in_quotes = False
                fields.append("".join(current))
                current = []
                continue
            else:
                # 引用符終了後に別の文字が続く場合
                in_quotes = False
                current.append(next_ch)
        elif ch == separator and not in_quotes:
            # フィールド区切り
            fields.append("".join(current))
            current = []
        else:
            current.append(ch)

    # 最後のフィールドを追加
    fields.append("".join(current))
    return fields


def _count_cloze_numbers(text: str) -> set[int]:
    """
    テキスト内のCloze番号（c1, c2, ...）のセットを返す。
    """
    return set(int(m.group(1)) for m in _CLOZE_PATTERN.finditer(text))


def _render_cloze_front(text: str, target_index: int) -> str:
    """
    Clozeカードの表面を生成する。
    対象のcloze番号は [...] に置換し、他の番号はテキストをそのまま表示する。
    """
    def replacer(m: re.Match) -> str:
        cloze_num = int(m.group(1))
        answer_text = m.group(2)
        # ヒントがある場合
        hint = m.group(3)
        if cloze_num == target_index:
            if hint:
                return f"[{hint}]"
            return "[...]"
        # 対象外のcloze番号はそのままテキスト表示
        return answer_text

    return _CLOZE_PATTERN.sub(replacer, text)


def _render_cloze_back(text: str, target_index: int) -> str:
    """
    Clozeカードの裏面を生成する。
    対象のcloze番号はハイライトし、他はそのまま表示する。
    """
    def replacer(m: re.Match) -> str:
        cloze_num = int(m.group(1))
        answer_text = m.group(2)
        if cloze_num == target_index:
            return f"<strong>{answer_text}</strong>"
        return answer_text

    return _CLOZE_PATTERN.sub(replacer, text)


def _has_filter_tags(tags_str: str) -> bool:
    """フィルタリング対象タグが含まれているか判定する"""
    if not tags_str.strip():
        return False
    tag_list = tags_str.strip().split()
    return bool(_FILTER_TAGS.intersection(tag_list))


def parse_data_line(
    line: str, header: ParsedHeader
) -> Optional[tuple[str, str, str, str, str, str]]:
    """
    データ行をパースして (guid, note_type, deck_name, front, back, tags) を返す。

    フィルタリング対象タグを持つ行はNoneを返す。
    """
    if not line.strip():
        return None

    fields = _split_tab_with_quotes(line, header.separator)

    # カラムインデックスは1ベース → 0ベースに変換
    def safe_get(idx: int) -> str:
        zero_based = idx - 1
        if 0 <= zero_based < len(fields):
            return fields[zero_based]
        return ""

    guid = safe_get(header.guid_column)
    note_type = safe_get(header.notetype_column)
    deck_name = safe_get(header.deck_column)
    tags = safe_get(header.tags_column)

    # フィールド4 と フィールド5 を表・裏に使用（固定位置）
    front = fields[3] if len(fields) > 3 else ""
    back = fields[4] if len(fields) > 4 else ""

    if not guid:
        return None

    # フィルタリング対象タグをチェック
    if _has_filter_tags(tags):
        return None

    return guid, note_type, deck_name, front, back, tags


def expand_cards(
    guid: str,
    note_type: str,
    deck_name: str,
    front: str,
    back: str,
    tags: str,
) -> list[ParsedCard]:
    """
    ノートタイプに応じてカードを展開する。

    - Basic: 1枚のカード
    - Basic (optional reversed card): 表→裏 と 裏→表 の2枚
    - Cloze: 各cloze番号ごとに1枚ずつ
    """
    cards: list[ParsedCard] = []

    if note_type == "Cloze":
        # Clozeカードの展開
        cloze_numbers = _count_cloze_numbers(front)
        if not cloze_numbers:
            # Cloze記法がない場合はそのまま1枚
            cards.append(ParsedCard(
                guid=guid,
                note_type=note_type,
                deck_name=deck_name,
                front=front,
                back=back or front,
                tags=tags,
                cloze_count=0,
                cloze_index=0,
            ))
        else:
            for cloze_num in sorted(cloze_numbers):
                cloze_front = _render_cloze_front(front, cloze_num)
                cloze_back = _render_cloze_back(front, cloze_num)
                cards.append(ParsedCard(
                    guid=guid,
                    note_type=note_type,
                    deck_name=deck_name,
                    front=cloze_front,
                    back=cloze_back,
                    tags=tags,
                    cloze_count=len(cloze_numbers),
                    cloze_index=cloze_num,
                ))

    elif note_type == "Basic (optional reversed card)":
        # 通常カード（表→裏）
        cards.append(ParsedCard(
            guid=guid,
            note_type=note_type,
            deck_name=deck_name,
            front=front,
            back=back,
            tags=tags,
        ))
        # 逆カード（裏→表） - backが存在する場合のみ
        if back.strip():
            cards.append(ParsedCard(
                guid=guid,
                note_type=note_type,
                deck_name=deck_name,
                front=back,
                back=front,
                tags=tags,
                is_reversed=True,
            ))

    else:
        # Basic およびその他のノートタイプ
        cards.append(ParsedCard(
            guid=guid,
            note_type=note_type,
            deck_name=deck_name,
            front=front,
            back=back,
            tags=tags,
        ))

    return cards


def parse_anki_file(content: str) -> list[ParsedCard]:
    """
    Ankiエクスポートファイルの全文をパースし、カードリストを返す。

    Args:
        content: ファイル内容（UTF-8テキスト）

    Returns:
        展開済みカードのリスト
    """
    lines = content.splitlines()
    if not lines:
        return []

    # ヘッダー解析
    header, data_start = parse_headers(lines)

    # データ行の解析と展開
    all_cards: list[ParsedCard] = []
    for line in lines[data_start:]:
        parsed = parse_data_line(line, header)
        if parsed is None:
            continue
        guid, note_type, deck_name, front, back, tags = parsed
        expanded = expand_cards(guid, note_type, deck_name, front, back, tags)
        all_cards.extend(expanded)

    return all_cards
