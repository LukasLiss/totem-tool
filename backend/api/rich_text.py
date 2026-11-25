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

import math
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

HEX_COLOR_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
_FONT_SIZE_RE = re.compile(r"^(\d{1,3})px$")

# Anchored, so a hostile scheme cannot hide in front of a legitimate-looking
# tail ("javascript:alert(1)//https://x"), and so "//evil.com" has no match.
_HTTP_SCHEME_RE = re.compile(r"^https?://", re.IGNORECASE)
_MAILTO_SCHEME_RE = re.compile(r"^mailto:", re.IGNORECASE)

# Stricter than RFC 5322 on purpose: no punctuation that would let one field
# carry a second recipient.
_EMAIL_RE = re.compile(
    r"^[^\s@,;:<>()\[\]\\\"]+"
    r"@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?"
    r"(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$"
)

# Everything between "scheme://" and the first "/", "?" or "#". A closed set,
# which is what rejects a space inside the host.
_AUTHORITY_RE = re.compile(r"^[A-Za-z0-9._~%!$&'()*+,;=:@\[\]-]+$")

# A browser strips TAB, CR and LF from a URL before using it, so a control
# character is a way to hide the real destination. Reject rather than strip.
_CONTROL_CHAR_RE = re.compile(r"[\x00-\x1f\x7f]")
_MAX_HREF_LENGTH = 2048

# Shared with the box-level fields validated in views/dashboards.py, so a run
# and the box it sits in accept the same range.
FONT_SIZE_MIN = 8
FONT_SIZE_MAX = 200
LINE_HEIGHT_MIN = 0.5
LINE_HEIGHT_MAX = 5.0
_HEADING_LEVELS = (1, 2, 3)
# What ProseMirror itself allows. A deeper heading (from a paste, or an older
# client whose StarterKit still offered all six) becomes the smallest one we
# render rather than the largest.
_ANY_HEADING_LEVELS = (1, 2, 3, 4, 5, 6)
# An ordered list numbered past this is a hostile payload, not a document.
_LIST_START_MAX = 100_000

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

# Nodes that belong inside a block, never directly under one.
_INLINE_NODES = ("text", "hardBreak")

# Blocks whose content is inline. Anything spliced into one has to be inline
# too, or the result nests a paragraph inside a paragraph.
_TEXTBLOCK_NODES = ("paragraph", "heading", "codeBlock")

# Bounds, so one dashboard cannot carry a document that costs every viewer a
# frozen tab. Generous next to any realistic annotation.
MAX_NODES = 5000
MAX_DEPTH = 20
MAX_TEXT_LENGTH = 100_000


class RichTextTooLarge(ValueError):
    """The document exceeded MAX_NODES / MAX_DEPTH / MAX_TEXT_LENGTH."""


def is_hex_color(raw):
    """True for a ``#rgb`` / ``#rrggbb`` literal, surrounding space allowed."""
    return isinstance(raw, str) and bool(HEX_COLOR_RE.match(raw.strip()))


def clamp_number(raw, minimum, maximum):
    """Clamp ``raw`` into ``[minimum, maximum]``, or None when it is no number.

    A bool is excluded on purpose: in Python it is an ``int``, so ``True``
    would otherwise become the minimum after clamping. A non-finite value is
    nonsense input rather than "very large", so it is None too.
    """
    if isinstance(raw, bool) or not isinstance(raw, (int, float, str)):
        return None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(value):
        return None
    return min(max(value, minimum), maximum)


def _clean_hex_color(raw):
    return raw.strip().lower() if is_hex_color(raw) else None


def _clean_font_size(raw):
    """Accept TipTap's ``"24px"`` form, clamped into the usable range."""
    if not isinstance(raw, str):
        return None
    match = _FONT_SIZE_RE.match(raw.strip())
    if not match:
        return None
    size = min(max(int(match.group(1)), FONT_SIZE_MIN), FONT_SIZE_MAX)
    return f"{size}px"


def _clean_line_height(raw):
    value = clamp_number(raw, LINE_HEIGHT_MIN, LINE_HEIGHT_MAX)
    return None if value is None else str(value)


def _clean_href(raw):
    """Return the href only when it is a bare http(s) URL or a lone mailto.

    Nothing else survives: no javascript:, no data:, no file:, no relative or
    protocol-relative reference, no scheme the list below does not name. The
    two accepted shapes are checked whole, never searched for, so a hostile
    scheme cannot hide in front of a legitimate-looking tail.
    """
    if not isinstance(raw, str):
        return None
    href = raw.strip()
    if not href or len(href) > _MAX_HREF_LENGTH:
        return None
    if _CONTROL_CHAR_RE.search(href):
        return None

    match = _HTTP_SCHEME_RE.match(href)
    if match:
        # Read off the string rather than with urlsplit: urlsplit (RFC 3986)
        # and the browser (WHATWG) disagree in both directions on inputs like
        # "https:///p" and "https://exa mple.com". Deciding it here keeps this
        # and `isSafeHref` in richText.ts answering identically.
        rest = href[match.end():]
        authority = re.split(r"[/?#]", rest, maxsplit=1)[0]
        if not authority or not _AUTHORITY_RE.match(authority):
            return None
        return href

    if _MAILTO_SCHEME_RE.match(href):
        address = href[len("mailto:"):]
        # A query string is the only way cc/bcc/body can ride along.
        if "?" in address or not _EMAIL_RE.match(address):
            return None
        return href

    return None


def _clean_dashboard_id(raw, allowed_ids):
    """Return the id only when it names a dashboard the caller vouches for.

    ``allowed_ids`` comes from the view, which knows the project being saved
    into. ``None`` means no project is known, so nothing is trusted.
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
            # Only the href is kept: the renderer sets target and rel itself,
            # so a stored value could only override what it decided.
            if href and "link" not in seen:
                # Otherwise 5000 maximal hrefs (~10MB) escape MAX_TEXT_LENGTH.
                budget.spend_text(len(href))
                seen.add("link")
                cleaned.append({"type": "link", "attrs": {"href": href}})
        elif mark_type == "dashboardLink":
            raw_attrs = mark.get("attrs")
            raw_attrs = raw_attrs if isinstance(raw_attrs, dict) else {}
            # An integer, never a string: no scheme for anything to hide in.
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
        if not isinstance(level, bool) and isinstance(level, int) and level in _ANY_HEADING_LEVELS:
            attrs["level"] = min(level, _HEADING_LEVELS[-1])
        else:
            attrs["level"] = 1
    if node_type == "orderedList":
        start = raw_attrs.get("start")
        # 1 is the default, so it is left off rather than stored.
        if (
            not isinstance(start, bool)
            and isinstance(start, int)
            and 1 < start <= _LIST_START_MAX
        ):
            attrs["start"] = start
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
    """Return a rebuilt node, None, or a list to splice into the parent.

    The list case is an unrecognised wrapper: the wrapper goes, its usable
    children stay.
    """
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
            raw.get("content"),
            budget,
            depth + 1,
            allowed_dashboard_ids,
            inline=node_type in _TEXTBLOCK_NODES,
        )
        if content:
            node["content"] = content
        return node

    # Unknown node type — drop the wrapper, keep the words it held. The list
    # is spliced into the parent by `_clean_content`, which also makes it fit
    # there, matching what `RichTextRenderer` does with the same case on the
    # way out.
    return _clean_content(raw.get("content"), budget, depth + 1, allowed_dashboard_ids)


def _as_inline(nodes):
    """Flatten any block nodes down to the inline content they hold.

    For content headed into a paragraph or heading: a block there would nest
    a paragraph inside a paragraph, which the editor's schema refuses.
    """
    inline = []
    for node in nodes:
        if node["type"] in _INLINE_NODES:
            inline.append(node)
        else:
            inline.extend(_as_inline(node.get("content") or []))
    return inline


def _as_blocks(nodes):
    """Wrap any bare inline nodes in a paragraph.

    Splicing inline content straight into a block position would make a
    document the editor's schema refuses, so the text would survive here only
    for ProseMirror to drop it on the next load.
    """
    blocks = []
    run = []
    for node in nodes:
        if node["type"] in _INLINE_NODES:
            run.append(node)
            continue
        if run:
            blocks.append({"type": "paragraph", "content": run})
            run = []
        blocks.append(node)
    if run:
        blocks.append({"type": "paragraph", "content": run})
    return blocks


def _clean_content(raw_content, budget, depth, allowed_dashboard_ids, inline=False):
    """Clean a node's children and make them fit where they are going.

    ``inline`` says the parent is a textblock: its content is flattened to
    inline nodes. Otherwise bare inline nodes are wrapped in paragraphs, so a
    run sent straight under ``doc`` or a list item still loads in the editor.
    """
    if not isinstance(raw_content, list):
        return []
    cleaned = []
    for child in raw_content:
        node = _clean_node(child, budget, depth, allowed_dashboard_ids)
        if isinstance(node, list):
            cleaned.extend(node)
        elif node is not None:
            cleaned.append(node)
    return _as_inline(cleaned) if inline else _as_blocks(cleaned)


def validated_rich_text(raw, allowed_dashboard_ids=None):
    """Rebuild ``raw`` from the whitelist, or return None to store nothing.

    None means "this box has no rich text" — the renderer then falls back to
    the plain `text` field with the box-level formatting, which is how every
    text box saved before this feature behaves.

    ``allowed_dashboard_ids`` is the set of dashboards a ``dashboardLink`` may
    point at — the view passes the ids in the document's own project. Leaving
    it unset drops every dashboard link, which is the right default for a
    caller that cannot say what the document belongs to.

    Raises ``RichTextTooLarge`` rather than returning None for a document
    that blows a limit: the caller has to tell that apart from "no rich text",
    or a user loses all their formatting to a 200 response.
    """
    if not isinstance(raw, dict) or raw.get("type") != "doc":
        return None
    budget = _Budget()
    content = _clean_content(raw.get("content"), budget, 1, allowed_dashboard_ids)
    if not content:
        return None
    return {"type": "doc", "content": content}


def plain_text_from_doc(doc):
    """Flatten a document to plain text, one line per paragraph.

    Keeps the `text` column meaningful for everything that still reads it —
    older clients, the sample-project seeder, and anyone eyeballing the DB.
    A line is a textblock, wherever it sits, so each item of a list gets its
    own line rather than running into the next. Mirrored by `plainTextFromDoc`
    in richText.ts.
    """
    if not isinstance(doc, dict):
        return ""
    lines = []

    def inline(node, out):
        node_type = node.get("type")
        if node_type == "text":
            out.append(node.get("text", ""))
        elif node_type == "hardBreak":
            out.append("\n")
        else:
            for child in node.get("content") or []:
                if isinstance(child, dict):
                    inline(child, out)

    def block(node):
        if node.get("type") in _TEXTBLOCK_NODES or node.get("type") in _INLINE_NODES:
            out = []
            inline(node, out)
            lines.append("".join(out))
            return
        for child in node.get("content") or []:
            if isinstance(child, dict):
                block(child)

    for top in doc.get("content") or []:
        if isinstance(top, dict):
            block(top)
    return "\n".join(lines)
