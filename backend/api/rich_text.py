"""Validation for the Text Box's rich-text document (#373 follow-up).

The document is a TipTap/ProseMirror tree that arrives from the browser and is
served back to everyone who can open the dashboard. It is never turned into
HTML — the frontend walks the tree into React elements — so this is not an
HTML sanitiser. What it does is rebuild the tree from a whitelist so that only
known node types, known marks and known attribute *values* are ever stored:
anything else is dropped rather than persisted and handed to other viewers.

Links are the sharp edge. A text box can carry a web link, an email link or a
link to another dashboard, and the first two end up in a real ``href`` that a
browser will act on. ``_clean_href`` is therefore the strictest thing in this
module, and dashboard links sidestep the question entirely by storing an
integer id instead of a URL.

Everything here is pure, so it is tested directly in
``TextBoxRichTextValidationTests`` without touching the database.
"""

import re
from urllib.parse import urlsplit

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

# An href is the one value here that a browser will act on rather than merely
# display, so it is matched against whole-string patterns and nothing else.
# Anchoring at the start is what makes "javascript:alert(1)//https://x" fail:
# the string only has to *look* like a URL somewhere for a naive search to
# pass it. Requiring the literal scheme is also what rejects the
# protocol-relative "//evil.com", which has no scheme token at all.
_HTTP_SCHEME_RE = re.compile(r"^https?://", re.IGNORECASE)
_MAILTO_SCHEME_RE = re.compile(r"^mailto:", re.IGNORECASE)

# One address, deliberately stricter than RFC 5322: a dotted domain and none
# of the punctuation that lets a single field carry a second recipient.
_EMAIL_RE = re.compile(
    r"^[^\s@,;:<>()\[\]\\\"]+"
    r"@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?"
    r"(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$"
)

# A browser silently strips TAB, CR and LF from a URL before using it, so a
# control character anywhere is a way to make the real destination differ from
# what a reader sees ("java\nscript:"). Reject outright rather than strip.
_CONTROL_CHAR_RE = re.compile(r"[\x00-\x1f\x7f]")
_MAX_HREF_LENGTH = 2048

_FONT_SIZE_MIN = 8
_FONT_SIZE_MAX = 200
_LINE_HEIGHT_MIN = 0.5
_LINE_HEIGHT_MAX = 5.0
_HEADING_LEVELS = (1, 2, 3)

# Marks that carry no attributes of their own.
_SIMPLE_MARKS = ("bold", "italic", "underline", "strike", "code")

# Block nodes the editor can produce.
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


def _clean_href(raw):
    """Return the href only when it is a bare http(s) URL or a lone mailto.

    Nothing else survives: no javascript:, no data:, no file:, no relative or
    protocol-relative reference, no scheme the list below does not name. The
    two accepted shapes are checked whole, never searched for, so a hostile
    scheme cannot hide in front of a legitimate-looking tail.
    """
    if not isinstance(raw, str):
        return None
    # Pasting a URL routinely picks up surrounding spaces; that much is worth
    # forgiving. Anything *inside* the string is not (see _CONTROL_CHAR_RE).
    href = raw.strip()
    if not href or len(href) > _MAX_HREF_LENGTH:
        return None
    if _CONTROL_CHAR_RE.search(href):
        return None

    if _HTTP_SCHEME_RE.match(href):
        try:
            parts = urlsplit(href)
        except ValueError:
            return None
        # "https://" with nothing after it parses fine and goes nowhere.
        return href if parts.hostname else None

    if _MAILTO_SCHEME_RE.match(href):
        address = href[len("mailto:"):]
        # A query string is the only way cc/bcc/subject/body can appear, and
        # those are what let a link do something other than what its text
        # says. Reject the whole href rather than quietly trimming them off.
        if "?" in address or not _EMAIL_RE.match(address):
            return None
        return href

    return None


def _clean_dashboard_id(raw, allowed_ids):
    """Return the id only when it names a dashboard the caller vouches for.

    ``allowed_ids`` is supplied by the view, which knows the project the
    document is being saved into; ``None`` means the caller has no project in
    hand, and then no dashboard link can be trusted at all.
    """
    if allowed_ids is None:
        return None
    # A bool is an int in Python, so reject it before the range check.
    if isinstance(raw, bool) or not isinstance(raw, int):
        return None
    if raw <= 0 or raw not in allowed_ids:
        return None
    return raw


def _clean_marks(raw_marks, budget, allowed_dashboard_ids):
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
        elif mark_type == "link":
            raw_attrs = mark.get("attrs")
            raw_attrs = raw_attrs if isinstance(raw_attrs, dict) else {}
            href = _clean_href(raw_attrs.get("href"))
            # Only the href is kept. The editor also sends target, rel, class
            # and title; none are read, because the renderer sets target and
            # rel itself. Storing them could only ever be a way to override
            # what the renderer decided.
            if href and "link" not in seen:
                # Hrefs count against the same ceiling as visible text.
                # Without this a document could carry 5000 maximal hrefs --
                # about 10MB -- while reporting almost no text at all.
                budget.spend_text(len(href))
                seen.add("link")
                cleaned.append({"type": "link", "attrs": {"href": href}})
        elif mark_type == "dashboardLink":
            raw_attrs = mark.get("attrs")
            raw_attrs = raw_attrs if isinstance(raw_attrs, dict) else {}
            # An integer, never a string: a link to another dashboard cannot
            # be a URL, so there is no scheme for anything to hide in.
            dashboard_id = _clean_dashboard_id(
                raw_attrs.get("dashboardId"), allowed_dashboard_ids
            )
            if dashboard_id is not None and "dashboardLink" not in seen:
                seen.add("dashboardLink")
                cleaned.append(
                    {"type": "dashboardLink", "attrs": {"dashboardId": dashboard_id}}
                )
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


def _clean_node(raw, budget, depth, allowed_dashboard_ids):
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
        marks = _clean_marks(raw.get("marks"), budget, allowed_dashboard_ids)
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
        content = _clean_content(
            raw.get("content"), budget, depth + 1, allowed_dashboard_ids
        )
        if content:
            node["content"] = content
        return node

    # Unknown node type — drop the node, but keep any recognised content it
    # wrapped, so text never silently disappears because of one stray node.
    return None


def _clean_content(raw_content, budget, depth, allowed_dashboard_ids):
    if not isinstance(raw_content, list):
        return []
    cleaned = []
    for child in raw_content:
        node = _clean_node(child, budget, depth, allowed_dashboard_ids)
        if node is not None:
            cleaned.append(node)
    return cleaned


def validated_rich_text(raw, allowed_dashboard_ids=None):
    """Rebuild ``raw`` from the whitelist, or return None to store nothing.

    None means "this box has no rich text" — the renderer then falls back to
    the plain `text` field with the box-level formatting, which is how every
    text box saved before this feature behaves.

    ``allowed_dashboard_ids`` is the set of dashboards a ``dashboardLink`` may
    point at — the view passes the ids in the document's own project. Leaving
    it unset drops every dashboard link, which is the right default for a
    caller that cannot say what the document belongs to.
    """
    if not isinstance(raw, dict) or raw.get("type") != "doc":
        return None
    budget = _Budget()
    try:
        content = _clean_content(raw.get("content"), budget, 1, allowed_dashboard_ids)
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
