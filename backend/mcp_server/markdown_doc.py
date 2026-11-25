"""
Turn the markdown a model writes into a Text Box rich-text document.

Dashboard text boxes store a TipTap/ProseMirror JSON tree (see
api/rich_text.py), not markdown, so markdown written by the assistant would
show up with literal `##` and `**`. This converts the subset models use in
notes: headings (#, ##, ###), bullet and numbered lists, paragraphs,
horizontal rules, and inline **bold**, *italic* / _italic_ and `code`.
The result is always passed through `validated_rich_text` before storage.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

_INLINE_RE = re.compile(r"(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\*[^*\n]+\*|(?<![\w])_[^_\n]+_(?![\w]))")
_HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")
_BULLET_RE = re.compile(r"^\s*[-*+]\s+(.*)$")
_ORDERED_RE = re.compile(r"^\s*(\d+)[.)]\s+(.*)$")
_RULE_RE = re.compile(r"^\s*(?:-{3,}|\*{3,}|_{3,})\s*$")


def _inline(text: str) -> List[Dict[str, Any]]:
    nodes: List[Dict[str, Any]] = []
    pos = 0
    for m in _INLINE_RE.finditer(text):
        if m.start() > pos:
            nodes.append({"type": "text", "text": text[pos:m.start()]})
        token = m.group(0)
        if token.startswith(("**", "__")):
            inner, mark = token[2:-2], "bold"
        elif token.startswith("`"):
            inner, mark = token[1:-1], "code"
        else:
            inner, mark = token[1:-1], "italic"
        if inner:
            nodes.append({"type": "text", "text": inner, "marks": [{"type": mark}]})
        pos = m.end()
    if pos < len(text):
        nodes.append({"type": "text", "text": text[pos:]})
    return [n for n in nodes if n["text"]]


def _paragraph(text: str) -> Optional[Dict[str, Any]]:
    content = _inline(text.strip())
    return {"type": "paragraph", "content": content} if content else None


def markdown_to_doc(markdown: str) -> Dict[str, Any]:
    blocks: List[Dict[str, Any]] = []
    para: List[str] = []
    list_node: Optional[Dict[str, Any]] = None

    def flush_paragraph():
        nonlocal para
        if para:
            node = _paragraph(" ".join(s.strip() for s in para))
            if node:
                blocks.append(node)
            para = []

    def flush_list():
        nonlocal list_node
        if list_node and list_node["content"]:
            blocks.append(list_node)
        list_node = None

    for line in (markdown or "").replace("\r\n", "\n").split("\n"):
        if not line.strip():
            flush_paragraph()
            flush_list()
            continue
        heading = _HEADING_RE.match(line)
        bullet = _BULLET_RE.match(line)
        ordered = _ORDERED_RE.match(line)
        if _RULE_RE.match(line):
            flush_paragraph()
            flush_list()
            blocks.append({"type": "horizontalRule"})
        elif heading:
            flush_paragraph()
            flush_list()
            content = _inline(heading.group(2).strip())
            if content:
                level = min(len(heading.group(1)), 3)
                blocks.append({"type": "heading", "attrs": {"level": level}, "content": content})
        elif bullet or ordered:
            flush_paragraph()
            kind = "bulletList" if bullet else "orderedList"
            if list_node is None or list_node["type"] != kind:
                flush_list()
                list_node = {"type": kind, "content": []}
                if ordered:
                    list_node["attrs"] = {"start": int(ordered.group(1))}
            item_text = bullet.group(1) if bullet else ordered.group(2)
            item = _paragraph(item_text)
            if item:
                list_node["content"].append({"type": "listItem", "content": [item]})
        else:
            flush_list()
            para.append(line)
    flush_paragraph()
    flush_list()
    return {"type": "doc", "content": blocks}
