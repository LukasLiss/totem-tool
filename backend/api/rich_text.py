"""Validation for the Text Box's rich-text document (#373 follow-up).

The document is a TipTap/ProseMirror tree that arrives from the browser and is
served back to everyone who can open the dashboard. It is never turned into
HTML — the frontend walks the tree into React elements — so this is not an
HTML sanitiser. What it does is rebuild the tree from a whitelist so that only
known node types, known marks and known attribute *values* are ever stored:
anything else is dropped rather than persisted and handed to other viewers.

Everything here is pure, so it is tested directly in
``TextBoxRichTextValidationTests`` without touching the database.
"""

import re

# A paragraph's own attributes. Alignment is a block property — you cannot
# centre half a word — so it lives here rather than on a mark.
_TEXT_ALIGNS = ("left", "center", "right", "justify")

# Font family is stored as a reference to a design-system token, and only
# these three literals are ever accepted. Storing the token (rather than a
# choice key) keeps the editor WYSIWYG, because the value is valid CSS as-is;
# whitelisting it to three exact strings means an arbitrary font string can
# still never reach a style attribute.
_FONT_FAMILIES = (
    "var(--font-sans)",
    "var(--font-serif)",
    "var(--font-mono)",
)

_HEX_COLOR_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
_FONT_SIZE_RE = re.compile(r"^(\d{1,3})px$")

_FONT_SIZE_MIN = 8
_FONT_SIZE_MAX = 200
_LINE_HEIGHT_MIN = 0.5
_LINE_HEIGHT_MAX = 5.0
_HEADING_LEVELS = (1, 2, 3)

# Marks that carry no attributes of their own.
_SIMPLE_MARKS = ("bold", "italic", "underline", "strike", "code")

# Block nodes the editor can produce. `link` is deliberately absent from the
# mark list below: it would carry an href, which is the one attribute here
# that could become a javascript: URL, and the toolbar offers no way to add
# one. The editor is configured with `link: false` to match.
_CONTAINER_NODES = (
    "paragraph",
    "heading",
    "blockquote",
    "bulletList",
    "orderedList",
    "listItem",
    "codeBlock",
)
_LEAF_NODES = ("horizontalRule", "hardBreak")

# Bounds, so one dashboard cannot carry a document that costs every viewer a
# frozen tab. Generous next to any realistic annotation.
MAX_NODES = 5000
MAX_DEPTH = 20
MAX_TEXT_LENGTH = 100_000


class RichTextTooLarge(ValueError):
    """The document exceeded MAX_NODES / MAX_DEPTH / MAX_TEXT_LENGTH."""


def _clean_hex_color(raw):
    if isinstance(raw, str) and _HEX_COLOR_RE.match(raw.strip()):
        return raw.strip().lower()
    return None


def _clean_font_size(raw):
    """Accept TipTap's ``"24px"`` form, clamped into the usable range."""
    if not isinstance(raw, str):
        return None
    match = _FONT_SIZE_RE.match(raw.strip())
    if not match:
        return None
    size = min(max(int(match.group(1)), _FONT_SIZE_MIN), _FONT_SIZE_MAX)
    return f"{size}px"


def _clean_line_height(raw):
    if isinstance(raw, bool) or not isinstance(raw, (int, float, str)):
        return None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    if value != value or value in (float("inf"), float("-inf")):
        return None
    return str(min(max(value, _LINE_HEIGHT_MIN), _LINE_HEIGHT_MAX))


def _clean_marks(raw_marks):
    """Keep recognised marks, in order, dropping unknown ones and duplicates."""
    if not isinstance(raw_marks, list):
        return []
    cleaned = []
    seen = set()
    for mark in raw_marks:
        if not isinstance(mark, dict):
            continue
        mark_type = mark.get("type")
        if mark_type in _SIMPLE_MARKS:
            if mark_type not in seen:
                seen.add(mark_type)
                cleaned.append({"type": mark_type})
        elif mark_type == "textStyle":
            raw_attrs = mark.get("attrs")
            raw_attrs = raw_attrs if isinstance(raw_attrs, dict) else {}
            attrs = {}
            color = _clean_hex_color(raw_attrs.get("color"))
            if color:
                attrs["color"] = color
            font_size = _clean_font_size(raw_attrs.get("fontSize"))
            if font_size:
                attrs["fontSize"] = font_size
            family = raw_attrs.get("fontFamily")
            if family in _FONT_FAMILIES:
                attrs["fontFamily"] = family
            # A textStyle with nothing left on it is noise; drop it.
            if attrs and "textStyle" not in seen:
                seen.add("textStyle")
                cleaned.append({"type": "textStyle", "attrs": attrs})
    return cleaned


def _clean_block_attrs(node_type, raw_attrs):
    attrs = {}
    raw_attrs = raw_attrs if isinstance(raw_attrs, dict) else {}
    if node_type in ("paragraph", "heading"):
        align = raw_attrs.get("textAlign")
        if align in _TEXT_ALIGNS:
            attrs["textAlign"] = align
        line_height = _clean_line_height(raw_attrs.get("lineHeight"))
        if line_height is not None:
            attrs["lineHeight"] = line_height
    if node_type == "heading":
        level = raw_attrs.get("level")
        # A bool is an int in Python, so reject it before the range check.
        if not isinstance(level, bool) and isinstance(level, int) and level in _HEADING_LEVELS:
            attrs["level"] = level
        else:
            attrs["level"] = 1
    return attrs


class _Budget:
    __slots__ = ("nodes", "text")

    def __init__(self):
        self.nodes = 0
        self.text = 0

    def spend_node(self):
        self.nodes += 1
        if self.nodes > MAX_NODES:
            raise RichTextTooLarge(f"document exceeds {MAX_NODES} nodes")

    def spend_text(self, length):
        self.text += length
        if self.text > MAX_TEXT_LENGTH:
            raise RichTextTooLarge(f"document exceeds {MAX_TEXT_LENGTH} characters")


def _clean_node(raw, budget, depth):
    """Return a rebuilt node, or None when it is not something we store."""
    if depth > MAX_DEPTH:
        raise RichTextTooLarge(f"document nests deeper than {MAX_DEPTH}")
    if not isinstance(raw, dict):
        return None
    node_type = raw.get("type")
    budget.spend_node()

    if node_type == "text":
        text = raw.get("text")
        if not isinstance(text, str) or not text:
            return None
        budget.spend_text(len(text))
        node = {"type": "text", "text": text}
        marks = _clean_marks(raw.get("marks"))
        if marks:
            node["marks"] = marks
        return node

    if node_type in _LEAF_NODES:
        return {"type": node_type}

    if node_type in _CONTAINER_NODES:
        node = {"type": node_type}
        attrs = _clean_block_attrs(node_type, raw.get("attrs"))
        if attrs:
            node["attrs"] = attrs
        content = _clean_content(raw.get("content"), budget, depth + 1)
        if content:
            node["content"] = content
        return node

    # Unknown node type — drop the node, but keep any recognised content it
    # wrapped, so text never silently disappears because of one stray node.
    return None


def _clean_content(raw_content, budget, depth):
    if not isinstance(raw_content, list):
        return []
    cleaned = []
    for child in raw_content:
        node = _clean_node(child, budget, depth)
        if node is not None:
            cleaned.append(node)
    return cleaned


def validated_rich_text(raw):
    """Rebuild ``raw`` from the whitelist, or return None to store nothing.

    None means "this box has no rich text" — the renderer then falls back to
    the plain `text` field with the box-level formatting, which is how every
    text box saved before this feature behaves.
    """
    if not isinstance(raw, dict) or raw.get("type") != "doc":
        return None
    budget = _Budget()
    try:
        content = _clean_content(raw.get("content"), budget, 1)
    except RichTextTooLarge:
        return None
    if not content:
        return None
    return {"type": "doc", "content": content}


def plain_text_from_doc(doc):
    """Flatten a document to plain text, one line per block.

    Keeps the `text` column meaningful for everything that still reads it —
    older clients, the sample-project seeder, and anyone eyeballing the DB.
    """
    if not isinstance(doc, dict):
        return ""
    lines = []

    def walk(node, line):
        node_type = node.get("type")
        if node_type == "text":
            line.append(node.get("text", ""))
            return
        if node_type == "hardBreak":
            line.append("\n")
            return
        for child in node.get("content") or []:
            if isinstance(child, dict):
                walk(child, line)

    for block in doc.get("content") or []:
        if not isinstance(block, dict):
            continue
        line = []
        walk(block, line)
        lines.append("".join(line))
    return "\n".join(lines)
