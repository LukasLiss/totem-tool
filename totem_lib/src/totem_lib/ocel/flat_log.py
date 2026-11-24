"""
Case-centric ("flat") event logs: XES files and plain CSV/TSV tables.

A flat log is one table with one row per event. Unlike an OCEL 2.0 file it
does not say which column holds what, so the user maps the columns first —
the same way Disco or ProM ask for it on import:

* **object id** columns become objects of a type the user names (the classic
  *case id* is one of them; several are allowed, which turns a flat table with
  ``Order ID`` and ``Item ID`` columns into an object-centric log),
* **resource** columns are object id columns too, of type ``resource`` by
  default, so the organizational mining views can use them,
* **activity** columns name the event (several are joined with ``" - "``),
* the **timestamp** column (exactly one) is parsed with a format the user
  picks, or detected automatically,
* **event attribute** and **object attribute** columns are copied over,
* everything else is ignored.

This module only turns the source into rows of ``{column: value}``
(:func:`iter_flat_rows`), builds the preview the mapping dialog shows
(:func:`preview_flat_log`) and stages the mapped rows into the DuckDB import
pipeline of :mod:`.importer_db` (:func:`stage_flat_log`). Parsing,
deduplication and indexing are shared with every other format.

XES specifics: trace attributes are exposed as ``case:<key>`` columns (the
convention pm4py and most tools use), event attributes under their own key.
``<global>`` defaults, classifiers and log-level attributes are not data and
are skipped; nested (meta) attributes are ignored, list/container values are
left out.
"""

from __future__ import annotations

import csv
import gzip
import io
import os
import re
import xml.etree.ElementTree as ET
import zlib
from dataclasses import dataclass, field
from datetime import datetime, timezone, tzinfo
from functools import lru_cache
from typing import Iterable, Iterator, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

ROLE_OBJECT_ID = "object_id"
ROLE_RESOURCE = "resource"
ROLE_ACTIVITY = "activity"
ROLE_TIMESTAMP = "timestamp"
ROLE_EVENT_ATTRIBUTE = "event_attribute"
ROLE_OBJECT_ATTRIBUTE = "object_attribute"
ROLE_IGNORE = "ignore"

ROLES = (
    ROLE_OBJECT_ID,
    ROLE_RESOURCE,
    ROLE_ACTIVITY,
    ROLE_TIMESTAMP,
    ROLE_EVENT_ATTRIBUTE,
    ROLE_OBJECT_ATTRIBUTE,
    ROLE_IGNORE,
)

# Timestamp "formats" that are not patterns.
FORMAT_AUTO = "auto"
FORMAT_UNIX_S = "unix_s"
FORMAT_UNIX_MS = "unix_ms"

ACTIVITY_SEPARATOR = " - "
DEFAULT_OBJECT_TYPE = "case"
DEFAULT_RESOURCE_TYPE = "resource"
# Initial object attribute values in OCEL 2.0 carry the epoch as their time.
_EPOCH_ISO = "1970-01-01T00:00:00+00:00"

_CSV_DELIMITERS = (",", ";", "\t", "|")
_XES_ATTRIBUTE_TAGS = frozenset({"string", "date", "int", "float", "boolean", "id"})
_XES_IGNORED_TAGS = frozenset({"list", "container"})

# Event attribute names that collide with the fixed schema columns.
_RESERVED_EVENT_ATTRS = frozenset({"event_id", "activity", "timestamp_unix"})
_RESERVED_OBJECT_ATTRS = frozenset({"obj_id", "obj_type", "timestamp_unix"})


class FlatLogMappingError(ValueError):
    """The column mapping cannot be used for this log."""


# ---------------------------------------------------------------------------
# Format detection
# ---------------------------------------------------------------------------

def flat_log_format(file_name: str) -> Optional[str]:
    """``"xes"`` / ``"csv"`` for a file name a flat log can have, else None."""
    name = file_name.lower()
    # Django de-duplicates "log.xes.gz" as "log.xes_AbC123.gz".
    if name.endswith(".xes") or (name.endswith(".gz") and ".xes" in name):
        return "xes"
    if name.endswith(".csv") or name.endswith(".tsv") or name.endswith(".txt"):
        return "csv"
    return None


def is_ocel_csv_header(columns: Iterable[str]) -> bool:
    """True for the OCEL 2.0 CSV layout (``activity`` + ``ot:<type>`` columns)."""
    cols = list(columns)
    return "activity" in cols and any(c.startswith("ot:") for c in cols)


# ---------------------------------------------------------------------------
# Timestamp parsing
# ---------------------------------------------------------------------------

# Longest tokens first so that "yyyy" is not read as two "yy".
_JAVA_TOKENS = (
    ("yyyy", "%Y"), ("yy", "%y"),
    ("MMMM", "%B"), ("MMM", "%b"), ("MM", "%m"), ("M", "%m"),
    ("dd", "%d"), ("d", "%d"),
    ("HH", "%H"), ("H", "%H"), ("hh", "%I"), ("h", "%I"),
    ("mm", "%M"), ("m", "%M"),
    ("ss", "%S"), ("s", "%S"),
    ("SSSSSS", "%f"), ("SSSSS", "%f"), ("SSSS", "%f"), ("SSS", "%f"), ("SS", "%f"), ("S", "%f"),
    ("EEEE", "%A"), ("EEE", "%a"),
    ("a", "%p"),
    ("XXX", "%z"), ("XX", "%z"), ("X", "%z"), ("ZZZ", "%z"), ("ZZ", "%z"), ("Z", "%z"),
)


def pattern_to_strptime(pattern: str) -> str:
    """Translate a Java/Disco style pattern (``dd.MM.yyyy HH:mm``) to strptime.

    A pattern that already contains ``%`` is taken to be a strptime format
    and returned unchanged. Text in single quotes is literal (``'T'``).
    """
    if "%" in pattern:
        return pattern
    out: list[str] = []
    i = 0
    while i < len(pattern):
        ch = pattern[i]
        if ch == "'":
            end = pattern.find("'", i + 1)
            if end == -1:
                end = len(pattern)
            literal = pattern[i + 1:end] or "'"
            out.append(literal.replace("%", "%%"))
            i = end + 1
            continue
        for token, directive in _JAVA_TOKENS:
            if pattern.startswith(token, i):
                out.append(directive)
                i += len(token)
                break
        else:
            out.append(ch)
            i += 1
    return "".join(out)


DEFAULT_TIMEZONE = "UTC"


@lru_cache(maxsize=64)
def resolve_timezone(name: Optional[str]) -> tzinfo:
    """The ``tzinfo`` for an IANA name (``"Europe/Berlin"``); UTC for None/"UTC".

    Raises ``FlatLogMappingError`` for a name the time zone database does
    not know.
    """
    name = (name or DEFAULT_TIMEZONE).strip() or DEFAULT_TIMEZONE
    if name.upper() in ("UTC", "Z", "GMT"):
        return timezone.utc
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError) as e:
        raise FlatLogMappingError(f"Unknown time zone '{name}'.") from e


def _iso(dt: datetime, tz: tzinfo = timezone.utc) -> str:
    # Only values that carry no zone of their own are placed in `tz`; an
    # explicit offset in the data always wins.
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=tz)
    return dt.isoformat()


def _parse_auto(value: str) -> Optional[datetime]:
    norm = value.strip()
    if norm.endswith(("Z", "z")):
        norm = norm[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(norm)
    except ValueError:
        pass
    for candidate in _AUTO_PATTERNS:
        try:
            return datetime.strptime(value.strip(), candidate)
        except ValueError:
            continue
    return None


def parse_timestamp(
    value: Optional[str],
    fmt: Optional[str] = FORMAT_AUTO,
    tz: Optional[str] = None,
) -> Optional[str]:
    """Parse ``value`` with ``fmt``; return an ISO 8601 string or None.

    ``fmt`` is ``"auto"`` (ISO 8601 and the common patterns in
    :data:`TIMESTAMP_PRESETS`), ``"unix_s"`` / ``"unix_ms"``, or a pattern
    accepted by :func:`pattern_to_strptime`. Values without a time zone of
    their own are read in ``tz`` (an IANA name, UTC by default); Unix times
    are absolute and ignore it. An unknown ``tz`` raises
    ``FlatLogMappingError``.
    """
    zone = resolve_timezone(tz)
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    fmt = (fmt or FORMAT_AUTO).strip() or FORMAT_AUTO
    try:
        if fmt == FORMAT_AUTO:
            dt = _parse_auto(text)
        elif fmt in (FORMAT_UNIX_S, FORMAT_UNIX_MS):
            seconds = float(text) / (1000.0 if fmt == FORMAT_UNIX_MS else 1.0)
            dt = datetime.fromtimestamp(seconds, tz=timezone.utc)
        else:
            dt = datetime.strptime(text, pattern_to_strptime(fmt))
    except (ValueError, OverflowError, OSError):
        return None
    return None if dt is None else _iso(dt, zone)


# Offered by the mapping dialog; also what "auto" and the suggestions try.
TIMESTAMP_PRESETS = (
    "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
    "yyyy-MM-dd HH:mm:ss",
    "yyyy-MM-dd HH:mm",
    "yyyy/MM/dd HH:mm:ss",
    "dd.MM.yyyy HH:mm:ss",
    "dd.MM.yyyy HH:mm",
    "dd-MM-yyyy HH:mm:ss",
    "dd/MM/yyyy HH:mm:ss",
    "dd/MM/yyyy HH:mm",
    "MM/dd/yyyy HH:mm:ss",
    "MM/dd/yyyy HH:mm",
    "MM/dd/yyyy hh:mm:ss a",
    "yyyy-MM-dd",
    "dd.MM.yyyy",
    "dd/MM/yyyy",
    "MM/dd/yyyy",
)
_AUTO_PATTERNS = tuple(
    pattern_to_strptime(p) for p in TIMESTAMP_PRESETS if "XXX" not in p
)


def suggest_timestamp_format(values: Iterable[str]) -> Optional[str]:
    """The first format that parses every non-empty sample, or None.

    ISO 8601 values get ``"auto"``; ambiguous day/month orders resolve to the
    first preset in :data:`TIMESTAMP_PRESETS` that fits (day first).
    """
    samples = [str(v).strip() for v in values if v is not None and str(v).strip()]
    if not samples:
        return None
    iso_ok = True
    for s in samples:
        norm = s[:-1] + "+00:00" if s.endswith(("Z", "z")) else s
        try:
            datetime.fromisoformat(norm)
        except ValueError:
            iso_ok = False
            break
    if iso_ok:
        return FORMAT_AUTO
    for preset in TIMESTAMP_PRESETS:
        if all(parse_timestamp(s, preset) for s in samples):
            return preset
    return None


# ---------------------------------------------------------------------------
# Reading rows
# ---------------------------------------------------------------------------

def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def _iter_xes(source, tolerate_truncation: bool = False) -> Iterator[dict]:
    """Yield one ``{column: value}`` per event of an XES stream.

    Trace attributes are prefixed with ``case:``. A trace's events are held
    until the trace closes, because XES does not require the trace
    attributes to precede its events.
    """
    stack: list[str] = []
    trace_attrs: dict = {}
    trace_events: list[dict] = []
    event_attrs: Optional[dict] = None
    root = None
    try:
        for kind, elem in ET.iterparse(source, events=("start", "end")):
            tag = _local(elem.tag)
            if kind == "start":
                if root is None:
                    root = elem
                stack.append(tag)
                if tag == "trace" and len(stack) == 2:
                    trace_attrs, trace_events = {}, []
                elif tag == "event" and len(stack) == 3 and stack[1] == "trace":
                    event_attrs = {}
                continue

            # kind == "end"
            parent = stack[-2] if len(stack) >= 2 else None
            depth = len(stack)
            if tag in _XES_ATTRIBUTE_TAGS:
                key = elem.get("key")
                value = elem.get("value")
                if key is not None and value is not None:
                    if parent == "trace" and depth == 3:
                        trace_attrs[f"case:{key}"] = value
                    elif parent == "event" and depth == 4 and event_attrs is not None:
                        event_attrs[key] = value
            elif tag == "event" and depth == 3 and stack[1] == "trace":
                if event_attrs is not None:
                    trace_events.append(event_attrs)
                event_attrs = None
                elem.clear()
            elif tag == "trace" and depth == 2:
                for ev in trace_events:
                    row = dict(trace_attrs)
                    row.update(ev)
                    yield row
                trace_attrs, trace_events = {}, []
            stack.pop()
            if depth == 2 and root is not None:
                # A finished trace or log-level element (globals, classifiers,
                # log attributes): detach it so memory stays flat.
                root.clear()
    except ET.ParseError:
        if not tolerate_truncation:
            raise
        # A truncated preview sample: hand out the events read so far.
        for ev in trace_events:
            row = dict(trace_attrs)
            row.update(ev)
            yield row


def _unique_names(header: list[str]) -> list[str]:
    seen: dict[str, int] = {}
    out = []
    for i, raw in enumerate(header):
        name = (raw or "").strip() or f"column_{i + 1}"
        if name in seen:
            seen[name] += 1
            name = f"{name} ({seen[name]})"
        else:
            seen[name] = 1
        out.append(name)
    return out


def detect_delimiter(sample: str) -> str:
    """The candidate delimiter that occurs most often in the header line."""
    first = sample.splitlines()[0] if sample else ""
    counts = {d: first.count(d) for d in _CSV_DELIMITERS}
    best = max(counts, key=lambda d: counts[d])
    return best if counts[best] > 0 else ","


def _iter_csv(handle, delimiter: str) -> tuple[list[str], Iterator[dict]]:
    reader = csv.reader(handle, delimiter=delimiter)
    try:
        header = next(reader)
    except StopIteration:
        return [], iter(())
    columns = _unique_names(header)

    def rows() -> Iterator[dict]:
        for raw in reader:
            if not raw or all(not (c or "").strip() for c in raw):
                continue
            yield {col: raw[i] for i, col in enumerate(columns) if i < len(raw)}

    return columns, rows()


def _is_gz(file_path: str) -> bool:
    return file_path.lower().endswith(".gz")


# ---------------------------------------------------------------------------
# Preview
# ---------------------------------------------------------------------------

_NAME_NORM = re.compile(r"[^a-z0-9]")


def _norm(name: str) -> str:
    return _NAME_NORM.sub("", name.lower())


def _object_type_from_column(name: str) -> str:
    base = re.sub(r"[\s_:\-]*(id|identifier|key|nr|no|number)$", "", name.strip(), flags=re.I)
    base = base.strip()
    if not base or _norm(base) in ("case", "caseconceptname", "trace"):
        return DEFAULT_OBJECT_TYPE
    return base


def _suggest_roles(columns: list[str], rows: list[dict], fmt: str) -> dict[str, dict]:
    """``{column: {"role": ..., ["object_type"|"format"|"target"]: ...}}``."""
    samples = {c: [r.get(c) for r in rows if (r.get(c) or "").strip()] for c in columns}
    out: dict[str, dict] = {}
    have_ts = False
    have_activity = False
    first_object: Optional[str] = None

    def object_role(col, role=ROLE_OBJECT_ID, object_type=None):
        nonlocal first_object
        out[col] = {"role": role, "object_type": object_type or _object_type_from_column(col)}
        if role == ROLE_OBJECT_ID and first_object is None:
            first_object = col

    if fmt == "xes":
        for col in columns:
            if col == "case:concept:name":
                object_role(col, object_type=DEFAULT_OBJECT_TYPE)
            elif col == "concept:name":
                out[col] = {"role": ROLE_ACTIVITY}
                have_activity = True
            elif col == "time:timestamp" and not have_ts:
                out[col] = {"role": ROLE_TIMESTAMP,
                            "format": suggest_timestamp_format(samples[col][:50]) or FORMAT_AUTO}
                have_ts = True
            elif col == "org:resource":
                object_role(col, ROLE_RESOURCE, DEFAULT_RESOURCE_TYPE)
    else:
        for col in columns:
            n = _norm(col)
            if first_object is None and (
                n in ("case", "caseid", "caseconceptname", "traceid", "caseidentifier")
                or (n.startswith("case") and n.endswith(("id", "name", "number", "nr")))
            ):
                object_role(col)
            elif not have_activity and (
                "activity" in n or n in ("event", "eventname", "conceptname", "action", "task", "step")
            ):
                out[col] = {"role": ROLE_ACTIVITY}
                have_activity = True
            elif not have_ts and any(k in n for k in ("timestamp", "time", "date", "completed", "start")):
                suggestion = suggest_timestamp_format(samples[col][:50])
                if suggestion:
                    out[col] = {"role": ROLE_TIMESTAMP, "format": suggestion}
                    have_ts = True
            elif n in ("resource", "orgresource", "user", "performer", "employee", "agent", "originator"):
                object_role(col, ROLE_RESOURCE, DEFAULT_RESOURCE_TYPE)

    for col in columns:
        if col in out:
            continue
        if fmt == "xes" and col.startswith("case:") and first_object is not None:
            out[col] = {"role": ROLE_OBJECT_ATTRIBUTE, "target": first_object}
        else:
            out[col] = {"role": ROLE_EVENT_ATTRIBUTE}
    return out


def _decompress_prefix(data: bytes) -> bytes:
    """Decompress as much of a (possibly truncated) gzip prefix as possible."""
    try:
        return zlib.decompressobj(16 + zlib.MAX_WBITS).decompress(data)
    except zlib.error:
        return b""


def preview_flat_log(
    data: bytes,
    file_name: str,
    max_rows: int = 100,
    truncated: bool = False,
    delimiter: Optional[str] = None,
) -> dict:
    """Describe the first rows of a flat log for the mapping dialog.

    ``data`` may be only the first part of the file (``truncated=True``):
    the last, possibly cut-off CSV line is dropped and an XML parse error at
    the end of an XES sample is tolerated.

    Returns ``{"format", "kind", "columns", "rows", "delimiter", "truncated",
    "timestamp_presets"}`` where ``kind`` is ``"flat"`` or ``"ocel_csv"`` (an
    OCEL 2.0 CSV, which needs no mapping) and every column is
    ``{"name", "suggestion": {...}, "empty": int, "distinct": int}``.
    """
    fmt = flat_log_format(file_name)
    if fmt is None:
        raise ValueError(f"'{file_name}' is not an XES or CSV file.")

    rows: list[dict] = []
    columns: list[str] = []
    used_delimiter: Optional[str] = None

    if fmt == "xes":
        if _is_gz(file_name):
            data = _decompress_prefix(data) if truncated else gzip.decompress(data)
        for row in _iter_xes(io.BytesIO(data), tolerate_truncation=True):
            rows.append(row)
            for key in row:
                if key not in columns:
                    columns.append(key)
            if len(rows) >= max_rows:
                break
        # Case attributes first, like the trace/event nesting in the file.
        columns.sort(key=lambda c: 0 if c.startswith("case:") else 1)
    else:
        text = data.decode("utf-8-sig", errors="replace")
        if truncated and "\n" in text:
            text = text[: text.rfind("\n") + 1]
        used_delimiter = delimiter or detect_delimiter(text)
        columns, row_iter = _iter_csv(io.StringIO(text, newline=""), used_delimiter)
        for row in row_iter:
            rows.append(row)
            if len(rows) >= max_rows:
                break

    kind = "ocel_csv" if fmt == "csv" and is_ocel_csv_header(columns) else "flat"
    suggestions = _suggest_roles(columns, rows, fmt) if kind == "flat" else {}
    column_info = []
    for col in columns:
        values = [(r.get(col) or "").strip() for r in rows]
        column_info.append({
            "name": col,
            "suggestion": suggestions.get(col, {"role": ROLE_IGNORE}),
            "empty": sum(1 for v in values if not v),
            "distinct": len({v for v in values if v}),
        })
    return {
        "format": fmt,
        "kind": kind,
        "columns": column_info,
        "rows": [[r.get(c, "") for c in columns] for r in rows],
        "delimiter": used_delimiter,
        "truncated": truncated,
        "timestamp_presets": list(TIMESTAMP_PRESETS),
    }


def iter_flat_rows(file_path: str, delimiter: Optional[str] = None, raw=None) -> Iterator[dict]:
    """Every event row of an XES or CSV file, as ``{column: value}``.

    ``raw`` is an optional binary handle on ``file_path`` to read from; the
    caller can follow ``raw.tell()`` for progress (for ``.xes.gz`` it is the
    position in the compressed file).
    """
    fmt = flat_log_format(file_path)
    own = raw is None
    if own:
        raw = open(file_path, "rb")
    try:
        if fmt == "xes":
            source = gzip.GzipFile(fileobj=raw) if _is_gz(file_path) else raw
            yield from _iter_xes(source)
            return
        # utf-8-sig strips a BOM; undecodable bytes must not abort an import.
        text = io.TextIOWrapper(raw, encoding="utf-8-sig", errors="replace", newline="")
        try:
            if delimiter is None:
                delimiter = detect_delimiter(text.read(64 * 1024))
                text.seek(0)
            _, rows = _iter_csv(text, delimiter)
            yield from rows
        finally:
            text.detach()
    finally:
        if own:
            raw.close()


# ---------------------------------------------------------------------------
# Mapping
# ---------------------------------------------------------------------------

@dataclass
class ColumnMapping:
    column: str
    role: str
    object_type: Optional[str] = None  # object_id / resource
    format: Optional[str] = None       # timestamp
    timezone: Optional[str] = None     # timestamp: zone of values without an offset
    target: Optional[str] = None       # object_attribute: the object id column
    name: Optional[str] = None         # attribute name (defaults to the column)


@dataclass
class FlatLogMapping:
    columns: list[ColumnMapping] = field(default_factory=list)
    delimiter: Optional[str] = None

    # -- construction -------------------------------------------------------

    @classmethod
    def from_dict(cls, data: dict) -> "FlatLogMapping":
        if not isinstance(data, dict):
            raise FlatLogMappingError("The column mapping must be an object.")
        raw_columns = data.get("columns")
        if not isinstance(raw_columns, list):
            raise FlatLogMappingError("The column mapping needs a 'columns' list.")
        cols = []
        for entry in raw_columns:
            if not isinstance(entry, dict) or not entry.get("column"):
                raise FlatLogMappingError("Every mapped column needs a 'column' name.")
            role = entry.get("role") or ROLE_IGNORE
            if role not in ROLES:
                raise FlatLogMappingError(f"Unknown role '{role}' for column '{entry['column']}'.")
            cols.append(ColumnMapping(
                column=str(entry["column"]),
                role=role,
                object_type=(str(entry["object_type"]).strip() or None) if entry.get("object_type") else None,
                format=(str(entry["format"]).strip() or None) if entry.get("format") else None,
                timezone=(str(entry["timezone"]).strip() or None) if entry.get("timezone") else None,
                target=str(entry["target"]) if entry.get("target") else None,
                name=(str(entry["name"]).strip() or None) if entry.get("name") else None,
            ))
        delimiter = data.get("delimiter") or None
        if delimiter is not None and (not isinstance(delimiter, str) or len(delimiter) != 1):
            raise FlatLogMappingError("The delimiter must be a single character.")
        mapping = cls(columns=cols, delimiter=delimiter)
        mapping.validate()
        return mapping

    @classmethod
    def suggested(cls, file_path: str, sample_rows: int = 200) -> "FlatLogMapping":
        """The mapping the dialog would propose, for scripted imports."""
        with open(file_path, "rb") as handle:
            data = handle.read(4 * 1024 * 1024)
        truncated = os.path.getsize(file_path) > len(data)
        preview = preview_flat_log(data, file_path, max_rows=sample_rows, truncated=truncated)
        cols = []
        for col in preview["columns"]:
            s = col["suggestion"]
            cols.append(ColumnMapping(
                column=col["name"], role=s.get("role", ROLE_IGNORE),
                object_type=s.get("object_type"), format=s.get("format"), target=s.get("target"),
            ))
        mapping = cls(columns=cols, delimiter=preview["delimiter"])
        mapping.validate()
        return mapping

    # -- checks -------------------------------------------------------------

    def by_role(self, *roles: str) -> list[ColumnMapping]:
        return [c for c in self.columns if c.role in roles]

    def validate(self) -> None:
        problems = []
        if not self.by_role(ROLE_OBJECT_ID):
            problems.append("Choose at least one object id (case id) column.")
        if not self.by_role(ROLE_ACTIVITY):
            problems.append("Choose at least one activity column.")
        ts = self.by_role(ROLE_TIMESTAMP)
        if len(ts) != 1:
            problems.append("Choose exactly one timestamp column.")
        for c in ts:
            try:
                resolve_timezone(c.timezone)
            except FlatLogMappingError as e:
                problems.append(str(e))
        object_cols = {c.column for c in self.by_role(ROLE_OBJECT_ID, ROLE_RESOURCE)}
        for c in self.by_role(ROLE_OBJECT_ATTRIBUTE):
            if c.target is not None and c.target not in object_cols:
                problems.append(
                    f"Object attribute '{c.column}' refers to '{c.target}', "
                    "which is not an object id column."
                )
        seen_cols = set()
        for c in self.columns:
            if c.column in seen_cols:
                problems.append(f"Column '{c.column}' is mapped twice.")
            seen_cols.add(c.column)
        if problems:
            raise FlatLogMappingError(" ".join(problems))


# ---------------------------------------------------------------------------
# Staging
# ---------------------------------------------------------------------------

def stage_flat_log(file_path: str, mapping: FlatLogMapping, buffers, tick=None, raw=None) -> dict:
    """Push the mapped rows of ``file_path`` into importer staging buffers.

    ``buffers`` is an ``importer_db._RowBuffers``; ``tick`` is called after
    every flush so the caller can report progress. Rows without an activity,
    without any object id or whose timestamp does not parse are skipped.

    Returns what happened, for the user: ``{"rows", "events",
    "skipped_no_activity", "skipped_no_object", "skipped_bad_timestamp",
    "bad_timestamp_example", "timestamp_format", "timezone"}``. Raises
    ``FlatLogMappingError`` when no row at all could be imported, with the
    reason that hit most.
    """
    from .importer_db import BATCH_SIZE  # local import: importer_db imports us

    activity_cols = [c.column for c in mapping.by_role(ROLE_ACTIVITY)]
    ts_col = mapping.by_role(ROLE_TIMESTAMP)[0]
    ts_fmt = ts_col.format or FORMAT_AUTO
    ts_zone = ts_col.timezone or DEFAULT_TIMEZONE
    object_cols = [
        (c.column, c.object_type or (DEFAULT_RESOURCE_TYPE if c.role == ROLE_RESOURCE
                                     else _object_type_from_column(c.column)))
        for c in mapping.by_role(ROLE_OBJECT_ID, ROLE_RESOURCE)
    ]
    first_object_col = mapping.by_role(ROLE_OBJECT_ID)[0].column
    case_cols = {c.column for c in mapping.by_role(ROLE_OBJECT_ID)}

    def attr_name(c: ColumnMapping, reserved: frozenset) -> str:
        name = c.name or c.column
        return f"{name}_attr" if name in reserved else name

    event_attrs = [(c.column, attr_name(c, _RESERVED_EVENT_ATTRS))
                   for c in mapping.by_role(ROLE_EVENT_ATTRIBUTE)]
    def object_attr_name(c: ColumnMapping) -> str:
        # "case:customer" is the customer *of the case*; on the object the
        # prefix only gets in the way.
        if c.name is None and c.column.startswith("case:") and len(c.column) > 5:
            c = ColumnMapping(c.column, c.role, name=c.column[5:])
        return attr_name(c, _RESERVED_OBJECT_ATTRS)

    object_attrs = [(c.column, c.target or first_object_col, object_attr_name(c))
                    for c in mapping.by_role(ROLE_OBJECT_ATTRIBUTE)]

    seen_objects: dict[tuple[str, str], None] = {}
    # (object type, object id) → {attribute: last value written}
    last_obj_attr: dict[tuple[str, str], dict[str, str]] = {}
    counts = {"events": 0, "skipped_no_activity": 0, "skipped_no_object": 0,
              "skipped_bad_timestamp": 0}
    first_bad_ts: Optional[str] = None
    # Object ids are namespaced by type only when two types share an id;
    # OCEL ids are global, so "1" as a case and "1" as a resource would merge.
    id_owner: dict[str, str] = {}

    def object_key(obj_type: str, raw_id: str) -> str:
        owner = id_owner.setdefault(raw_id, obj_type)
        return raw_id if owner == obj_type else f"{obj_type}:{raw_id}"

    n = 0
    for row in iter_flat_rows(file_path, mapping.delimiter, raw=raw):
        parts = [(row.get(c) or "").strip() for c in activity_cols]
        activity = ACTIVITY_SEPARATOR.join(p for p in parts if p)
        if not activity:
            counts["skipped_no_activity"] += 1
            continue
        linked = []
        for col, obj_type in object_cols:
            raw = (row.get(col) or "").strip()
            if raw:
                linked.append((col, obj_type, object_key(obj_type, raw)))
        # A resource alone does not make an event: it needs a case object.
        if not any(col in case_cols for col, _, _ in linked):
            counts["skipped_no_object"] += 1
            continue
        raw_ts = (row.get(ts_col.column) or "").strip()
        # Parsed here, with the parser the dialog's check uses, so "auto"
        # means the same thing in the preview and in the import.
        ts_value = parse_timestamp(raw_ts, ts_fmt, ts_zone)
        if ts_value is None:
            counts["skipped_bad_timestamp"] += 1
            if first_bad_ts is None:
                first_bad_ts = raw_ts
            continue

        n += 1
        event_id = f"e{n}"
        buffers.add_event(event_id, activity, ts_value)
        for col, name in event_attrs:
            value = (row.get(col) or "").strip()
            if value:
                buffers.add_event_attr(event_id, name, value)
        obj_by_col = {}
        for col, obj_type, obj_id in linked:
            obj_by_col[col] = (obj_type, obj_id)
            if (obj_type, obj_id) not in seen_objects:
                seen_objects[(obj_type, obj_id)] = None
                buffers.add_object(obj_id, obj_type)
            buffers.add_event_object(event_id, obj_id, None)
        for col, target, name in object_attrs:
            owner = obj_by_col.get(target)
            value = (row.get(col) or "").strip()
            if owner is None or not value:
                continue
            last = last_obj_attr.setdefault(owner, {})
            if last.get(name) == value:
                continue
            # The first value is the object's initial one; later changes are
            # recorded at the time of the event that shows them.
            when = _EPOCH_ISO if name not in last else ts_value
            last[name] = value
            buffers.add_object_attr(owner[1], when, name, value)

        if buffers.size() >= BATCH_SIZE:
            buffers.flush()
            if tick is not None:
                tick()

    buffers.flush()
    counts["events"] = n
    counts["rows"] = n + counts["skipped_no_activity"] + counts["skipped_no_object"] + counts["skipped_bad_timestamp"]
    counts["bad_timestamp_example"] = first_bad_ts
    counts["timestamp_format"] = ts_fmt
    counts["timezone"] = ts_zone
    if n == 0:
        if counts["skipped_bad_timestamp"] and first_bad_ts:
            raise FlatLogMappingError(
                f"No timestamp matched the format '{ts_fmt}' "
                f"(for example '{first_bad_ts}'). Pick another timestamp format."
            )
        reason = max(
            ("skipped_no_activity", "skipped_no_object", "skipped_bad_timestamp"),
            key=lambda k: counts[k],
        )
        detail = {
            "skipped_no_activity": "the activity column is empty in every row",
            "skipped_no_object": "the object id column is empty in every row",
            "skipped_bad_timestamp": "the timestamp column is empty in every row",
        }[reason]
        raise FlatLogMappingError(f"No events could be imported: {detail}.")
    return counts


__all__ = [
    "ColumnMapping",
    "FlatLogMapping",
    "FlatLogMappingError",
    "ROLES",
    "TIMESTAMP_PRESETS",
    "flat_log_format",
    "is_ocel_csv_header",
    "iter_flat_rows",
    "parse_timestamp",
    "pattern_to_strptime",
    "resolve_timezone",
    "preview_flat_log",
    "stage_flat_log",
    "suggest_timestamp_format",
]
