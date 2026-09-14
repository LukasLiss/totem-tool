"""Resolve references between stored SQL queries.

A stored query (``ProjectAsset`` of type QUERY) can be used inside another
query like a table, by name::

    SELECT avg(duration_s) FROM "Process execution duration"

Before execution the referenced stored queries are prepended as common
table expressions (CTEs), so the query above becomes::

    WITH "Process execution duration" AS (<stored SQL>)
    SELECT avg(duration_s) FROM "Process execution duration"

References are resolved transitively (a stored query may itself reference
other stored queries) in dependency order; cycles are rejected. Names that
are valid bare identifiers can be referenced unquoted as well
(``FROM waiting_times``); any other name must be double-quoted.
"""

from __future__ import annotations

import re
from typing import Dict, Iterable, List, Mapping, Set

_BARE_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_LEADING_WITH = re.compile(r"^\s*with\s+(recursive\s+)?", re.IGNORECASE)
# Comments and string literals: their contents must not count as references.
_NOISE = re.compile(
    r"--[^\n]*|/\*[\s\S]*?\*/|'(?:[^']|'')*'",
)
_LEADING_COMMENTS = re.compile(r"^(?:\s*(?:--[^\n]*\n|/\*[\s\S]*?\*/))*\s*")


class QueryReferenceError(ValueError):
    """User-facing error for unresolvable stored-query references."""


def quote_identifier(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _reference_pattern(name: str) -> re.Pattern:
    quoted = re.escape(quote_identifier(name))
    if _BARE_IDENTIFIER.match(name):
        # A bare name counts only as a whole word that is not a function call
        # (`avg(`), not schema-qualified (`main.avg`) and not a column of
        # something else (`t.avg`).
        return re.compile(
            rf"(?<![\w\".]){re.escape(name)}(?![\w\"]|\s*\()|{quoted}", re.IGNORECASE
        )
    return re.compile(quoted)


def find_references(query: str, names: Iterable[str]) -> List[str]:
    """Names from ``names`` that ``query`` references (comments/strings ignored)."""
    scrubbed = _NOISE.sub(" ", query)
    return [name for name in names if _reference_pattern(name).search(scrubbed)]


def strip_statement(sql: str) -> str:
    return sql.strip().rstrip(";").strip()


def resolve_query_references(
    query: str,
    stored: Mapping[str, str],
    reserved: Iterable[str] = (),
    self_name: str | None = None,
) -> str:
    """Return ``query`` with every referenced stored query prepended as a CTE.

    ``stored`` maps stored-query names to their SQL. ``reserved`` names (the
    log's real tables) are never treated as references. ``self_name`` is the
    stored query being edited, if any, so a self-reference is reported as a
    cycle rather than silently shadowing.
    """
    reserved_lower = {r.lower() for r in reserved}
    candidates = {
        name: sql for name, sql in stored.items() if name.lower() not in reserved_lower
    }
    ordered: List[str] = []
    state: Dict[str, str] = {}  # name -> "visiting" | "done"

    def visit(name: str, trail: List[str]) -> None:
        if state.get(name) == "done":
            return
        if state.get(name) == "visiting":
            cycle = " -> ".join(trail[trail.index(name):] + [name])
            raise QueryReferenceError(f"Circular reference between stored queries: {cycle}")
        state[name] = "visiting"
        for dep in find_references(candidates[name], candidates.keys()):
            visit(dep, trail + [name])
        state[name] = "done"
        ordered.append(name)

    roots = find_references(query, candidates.keys())
    if self_name is not None and self_name in roots:
        raise QueryReferenceError(
            f'A stored query cannot reference itself ("{self_name}").'
        )
    for root in roots:
        visit(root, [self_name] if self_name else [])
    if not ordered:
        return query

    ctes = ", ".join(
        f"{quote_identifier(name)} AS ({strip_statement(candidates[name])})"
        for name in ordered
    )
    body = _LEADING_COMMENTS.sub("", strip_statement(query))
    match = _LEADING_WITH.match(body)
    if match:
        # Merge into the query's own WITH clause: WITH [RECURSIVE] a AS (...), <user ctes>
        recursive = "RECURSIVE " if match.group(1) else ""
        return f"WITH {recursive}{ctes}, {body[match.end():]}"
    return f"WITH {ctes} {body}"


def referenced_names(query: str, stored: Mapping[str, str], reserved: Iterable[str] = ()) -> Set[str]:
    """All stored-query names ``query`` depends on, transitively."""
    reserved_lower = {r.lower() for r in reserved}
    candidates = {n: s for n, s in stored.items() if n.lower() not in reserved_lower}
    seen: Set[str] = set()
    todo = find_references(query, candidates.keys())
    while todo:
        name = todo.pop()
        if name in seen:
            continue
        seen.add(name)
        todo.extend(find_references(candidates[name], candidates.keys()))
    return seen
