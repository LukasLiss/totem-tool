"""Case-centric ("flat") logs: XES and plain CSV with a column mapping."""

import gzip
import shutil
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))

from totem_lib.ocel.flat_log import (
    FORMAT_AUTO,
    FlatLogMapping,
    FlatLogMappingError,
    flat_log_format,
    parse_timestamp,
    pattern_to_strptime,
    preview_flat_log,
    suggest_timestamp_format,
)
from totem_lib.ocel.importer_db import import_ocel_db

XES = Path(__file__).parent.parent.parent / "example_data" / "order_handling_case_log.xes"


def _rows(db, sql):
    return db.conn.execute(sql).fetchall()


# ---------------------------------------------------------------------------
# Timestamps
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("pattern,expected", [
    ("yyyy-MM-dd HH:mm:ss", "%Y-%m-%d %H:%M:%S"),
    ("dd.MM.yyyy HH:mm", "%d.%m.%Y %H:%M"),
    ("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", "%Y-%m-%dT%H:%M:%S.%f%z"),
    ("MM/dd/yyyy hh:mm a", "%m/%d/%Y %I:%M %p"),
    ("%d/%m/%Y", "%d/%m/%Y"),
])
def test_pattern_to_strptime(pattern, expected):
    assert pattern_to_strptime(pattern) == expected


def test_parse_timestamp_formats():
    assert parse_timestamp("01.03.2024 09:05", "dd.MM.yyyy HH:mm") == "2024-03-01T09:05:00+00:00"
    assert parse_timestamp("2024-03-01T09:00:00.000+01:00", FORMAT_AUTO) == "2024-03-01T09:00:00+01:00"
    assert parse_timestamp("1709283600", "unix_s") == "2024-03-01T09:00:00+00:00"
    assert parse_timestamp("1709283600000", "unix_ms") == "2024-03-01T09:00:00+00:00"
    assert parse_timestamp("not a date", "dd.MM.yyyy") is None
    assert parse_timestamp("", FORMAT_AUTO) is None


def test_parse_timestamp_time_zone():
    # Values without a zone are read in the chosen one, summer time included.
    berlin = "Europe/Berlin"
    assert parse_timestamp("01.03.2024 09:00", "dd.MM.yyyy HH:mm", berlin) == "2024-03-01T09:00:00+01:00"
    assert parse_timestamp("01.07.2024 09:00", "dd.MM.yyyy HH:mm", berlin) == "2024-07-01T09:00:00+02:00"
    assert parse_timestamp("2024-03-01 09:00:00", "auto", "America/New_York") == "2024-03-01T09:00:00-05:00"
    # An offset in the data wins; Unix time is absolute.
    assert parse_timestamp("2024-03-01T09:00:00+00:00", "auto", berlin) == "2024-03-01T09:00:00+00:00"
    assert parse_timestamp("1709283600", "unix_s", berlin) == "2024-03-01T09:00:00+00:00"
    assert parse_timestamp("01.03.2024 09:00", "dd.MM.yyyy HH:mm", None) == "2024-03-01T09:00:00+00:00"


def test_unknown_time_zone_is_rejected():
    with pytest.raises(FlatLogMappingError, match="Unknown time zone"):
        parse_timestamp("2024-03-01", "auto", "Mars/Olympus_Mons")
    with pytest.raises(FlatLogMappingError, match="Unknown time zone"):
        FlatLogMapping.from_dict({"columns": [
            {"column": "c", "role": "object_id"},
            {"column": "a", "role": "activity"},
            {"column": "t", "role": "timestamp", "timezone": "Nowhere/Land"},
        ]})


def test_suggest_timestamp_format():
    assert suggest_timestamp_format(["2024-03-01 09:00:00", "2024-03-02T10:00:00Z"]) == FORMAT_AUTO
    assert suggest_timestamp_format(["13.03.2024 09:00", "01.04.2024 10:00"]) == "dd.MM.yyyy HH:mm"
    assert suggest_timestamp_format(["03/13/2024 09:00:00"]) == "MM/dd/yyyy HH:mm:ss"
    assert suggest_timestamp_format(["hello"]) is None


def test_format_detection():
    assert flat_log_format("log.xes") == "xes"
    assert flat_log_format("log.XES.gz") == "xes"
    assert flat_log_format("log.xes_AbC123.gz") == "xes"  # Django's de-duplicated name
    assert flat_log_format("log.csv") == "csv"
    assert flat_log_format("log.json") is None


# ---------------------------------------------------------------------------
# XES
# ---------------------------------------------------------------------------

def test_xes_preview_flattens_traces_and_suggests_roles():
    preview = preview_flat_log(XES.read_bytes(), XES.name)
    assert preview["format"] == "xes"
    assert preview["kind"] == "flat"
    names = [c["name"] for c in preview["columns"]]
    # Trace attributes first, prefixed; <global> defaults are not data.
    assert names[:3] == ["case:concept:name", "case:customer", "case:order value"]
    assert "concept:name" in names and "time:timestamp" in names
    assert "__INVALID__" not in {v for row in preview["rows"] for v in row}
    assert len(preview["rows"]) == 8

    roles = {c["name"]: c["suggestion"] for c in preview["columns"]}
    assert roles["case:concept:name"] == {"role": "object_id", "object_type": "case"}
    assert roles["concept:name"]["role"] == "activity"
    assert roles["time:timestamp"] == {"role": "timestamp", "format": "auto"}
    assert roles["org:resource"] == {"role": "resource", "object_type": "resource"}
    assert roles["case:customer"] == {"role": "object_attribute", "target": "case:concept:name"}
    assert roles["lifecycle:transition"]["role"] == "event_attribute"


def test_xes_preview_tolerates_a_truncated_sample():
    data = XES.read_bytes()
    preview = preview_flat_log(data[: len(data) // 2], XES.name, truncated=True)
    assert 0 < len(preview["rows"]) < 8


def test_xes_import_with_suggested_mapping():
    db = import_ocel_db(str(XES))
    try:
        assert _rows(db, "SELECT COUNT(*) FROM events") == [(8,)]
        types = dict(_rows(db, "SELECT obj_type, COUNT(*) FROM objects GROUP BY 1"))
        assert types == {"case": 3, "resource": 4}
        # Order 1's events, in order, with their resource linked as an object.
        rows = _rows(db, """
            SELECT e.activity, e.timestamp_unix
            FROM events e JOIN event_object eo USING (event_id)
            WHERE eo.obj_id = 'order-1' ORDER BY e.timestamp_unix
        """)
        assert [r[0] for r in rows] == ["Register order", "Check credit", "Ship goods"]
        assert rows[0][1] == 1709280000  # 2024-03-01T09:00+01:00
        assert _rows(db, "SELECT customer FROM objects WHERE obj_id = 'order-2'") == [("Globex",)]
        assert _rows(db, """
            SELECT COUNT(*) FROM event_object WHERE obj_id = 'Bob'
        """) == [(3,)]
    finally:
        db.close()


def test_xes_gz_import(tmp_path):
    target = tmp_path / "orders.xes.gz"
    with open(XES, "rb") as src, gzip.open(target, "wb") as dst:
        shutil.copyfileobj(src, dst)
    db = import_ocel_db(str(target))
    try:
        assert _rows(db, "SELECT COUNT(*) FROM events") == [(8,)]
    finally:
        db.close()


def test_xes_import_with_custom_mapping():
    mapping = {
        "columns": [
            {"column": "case:concept:name", "role": "object_id", "object_type": "Order"},
            {"column": "concept:name", "role": "activity"},
            {"column": "lifecycle:transition", "role": "activity"},
            {"column": "time:timestamp", "role": "timestamp", "format": "auto"},
            {"column": "org:resource", "role": "ignore"},
            {"column": "case:customer", "role": "object_id", "object_type": "Customer"},
        ],
    }
    db = import_ocel_db(str(XES), mapping=mapping)
    try:
        types = dict(_rows(db, "SELECT obj_type, COUNT(*) FROM objects GROUP BY 1"))
        assert types == {"Order": 3, "Customer": 2}
        acts = {r[0] for r in _rows(db, "SELECT DISTINCT activity FROM events")}
        assert "Register order - complete" in acts
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Plain CSV
# ---------------------------------------------------------------------------

CSV_TEXT = (
    "Case ID;Activity;Start Time;Resource;Cost\n"
    "c1;Register;01.03.2024 09:00;Alice;10\n"
    "c1;Approve;01.03.2024 10:30;Bob;\n"
    "c2;Register;02.03.2024 08:00;Alice;12\n"
    ";Orphan;02.03.2024 08:30;Alice;1\n"
)


def test_csv_preview_detects_delimiter_and_roles():
    preview = preview_flat_log(CSV_TEXT.encode(), "log.csv")
    assert preview["delimiter"] == ";"
    assert preview["kind"] == "flat"
    roles = {c["name"]: c["suggestion"] for c in preview["columns"]}
    assert roles["Case ID"] == {"role": "object_id", "object_type": "case"}
    assert roles["Activity"]["role"] == "activity"
    assert roles["Start Time"] == {"role": "timestamp", "format": "dd.MM.yyyy HH:mm"}
    assert roles["Resource"]["role"] == "resource"
    assert roles["Cost"]["role"] == "event_attribute"


def test_ocel_csv_is_recognised_and_needs_no_mapping():
    text = "id,activity,timestamp,ot:order\ne1,Create,2024-01-01T00:00:00Z,o1\n"
    assert preview_flat_log(text.encode(), "log.csv")["kind"] == "ocel_csv"


def test_csv_import_with_mapping(tmp_path):
    path = tmp_path / "log.csv"
    path.write_text(CSV_TEXT, encoding="utf-8")
    mapping = FlatLogMapping.suggested(str(path))
    db = import_ocel_db(str(path), mapping=mapping)
    try:
        # The row without a case id is skipped.
        assert _rows(db, "SELECT COUNT(*) FROM events") == [(3,)]
        assert _rows(db, "SELECT timestamp_unix FROM events WHERE activity = 'Approve'") == [(1709289000,)]
        assert _rows(db, "SELECT Cost FROM events WHERE activity = 'Approve'") == [(None,)]
    finally:
        db.close()


def test_csv_auto_format_parses_what_the_preview_check_accepts(tmp_path):
    # "auto" in the dialog accepts day-first dates; the import must too.
    path = tmp_path / "log.csv"
    path.write_text(CSV_TEXT, encoding="utf-8")
    mapping = {
        "delimiter": ";",
        "columns": [
            {"column": "Case ID", "role": "object_id"},
            {"column": "Activity", "role": "activity"},
            {"column": "Start Time", "role": "timestamp", "format": "auto"},
        ],
    }
    db = import_ocel_db(str(path), mapping=mapping)
    try:
        assert _rows(db, "SELECT MIN(timestamp_unix) FROM events") == [(1709283600,)]
    finally:
        db.close()


def test_csv_import_in_a_time_zone(tmp_path):
    path = tmp_path / "log.csv"
    path.write_text(CSV_TEXT, encoding="utf-8")
    mapping = {
        "delimiter": ";",
        "columns": [
            {"column": "Case ID", "role": "object_id"},
            {"column": "Activity", "role": "activity"},
            {"column": "Start Time", "role": "timestamp", "format": "dd.MM.yyyy HH:mm",
             "timezone": "Europe/Berlin"},
        ],
    }
    db = import_ocel_db(str(path), mapping=mapping)
    try:
        # 01.03.2024 09:00 in Berlin is 08:00 UTC.
        assert _rows(db, "SELECT MIN(timestamp_unix) FROM events") == [(1709280000,)]
    finally:
        db.close()


def test_import_report_counts_what_was_skipped(tmp_path):
    path = tmp_path / "log.csv"
    path.write_text(
        CSV_TEXT
        + "c3;Register;2024-03-05 10:00;Alice;3\n"   # other format: skipped
        + "c3;;05.03.2024 11:00;Alice;3\n",          # no activity: skipped
        encoding="utf-8",
    )
    mapping = {
        "delimiter": ";",
        "columns": [
            {"column": "Case ID", "role": "object_id"},
            {"column": "Activity", "role": "activity"},
            {"column": "Start Time", "role": "timestamp", "format": "dd.MM.yyyy HH:mm"},
        ],
    }
    report = {}
    import_ocel_db(str(path), mapping=mapping, import_report=report).close()
    assert report["rows"] == 6
    assert report["events"] == 3
    assert report["skipped_no_object"] == 1
    assert report["skipped_no_activity"] == 1
    assert report["skipped_bad_timestamp"] == 1
    assert report["bad_timestamp_example"] == "2024-03-05 10:00"
    assert report["timestamp_format"] == "dd.MM.yyyy HH:mm"
    assert report["timezone"] == "UTC"


def test_csv_wrong_timestamp_format_names_an_example(tmp_path):
    path = tmp_path / "log.csv"
    path.write_text(CSV_TEXT, encoding="utf-8")
    mapping = {
        "delimiter": ";",
        "columns": [
            {"column": "Case ID", "role": "object_id"},
            {"column": "Activity", "role": "activity"},
            {"column": "Start Time", "role": "timestamp", "format": "yyyy-MM-dd"},
        ],
    }
    with pytest.raises(FlatLogMappingError, match="01.03.2024 09:00"):
        import_ocel_db(str(path), mapping=mapping)


@pytest.mark.parametrize("columns,message", [
    ([{"column": "a", "role": "activity"}, {"column": "t", "role": "timestamp"}], "object id"),
    ([{"column": "c", "role": "object_id"}, {"column": "t", "role": "timestamp"}], "activity"),
    ([{"column": "c", "role": "object_id"}, {"column": "a", "role": "activity"}], "timestamp"),
    ([{"column": "c", "role": "nonsense"}], "Unknown role"),
])
def test_invalid_mappings_are_rejected(columns, message):
    with pytest.raises(FlatLogMappingError, match=message):
        FlatLogMapping.from_dict({"columns": columns})


# ---------------------------------------------------------------------------
# Regressions found in review (#451)
# ---------------------------------------------------------------------------

def _csv(tmp_path, text, encoding="utf-8", name="log.csv"):
    path = tmp_path / name
    path.write_bytes(text.encode(encoding))
    return str(path)


BASE_COLS = [
    {"column": "case", "role": "object_id"},
    {"column": "act", "role": "activity"},
    {"column": "ts", "role": "timestamp", "format": "auto"},
]


def test_events_with_equal_timestamps_keep_file_order(tmp_path):
    # Analyses break ties with ORDER BY timestamp_unix, event_id; unpadded
    # ids put "e10" before "e2".
    rows = "".join(f"c1;Step{i};2024-01-01\n" for i in range(1, 13))
    db = import_ocel_db(_csv(tmp_path, "case;act;ts\n" + rows),
                        mapping={"delimiter": ";", "columns": BASE_COLS})
    try:
        order = [r[0] for r in _rows(db, "SELECT activity FROM events ORDER BY timestamp_unix, event_id")]
        assert order == [f"Step{i}" for i in range(1, 13)]
    finally:
        db.close()


def test_attribute_names_that_clash_ignoring_case_are_renamed(tmp_path):
    path = _csv(tmp_path, "case;act;ts;Activity;Status;status\nc1;A;2024-01-01;x;open;o\n")
    report = {}
    mapping = {"delimiter": ";", "columns": BASE_COLS + [
        {"column": "Activity", "role": "event_attribute"},
        {"column": "Status", "role": "event_attribute"},
        {"column": "status", "role": "event_attribute"},
    ]}
    db = import_ocel_db(path, mapping=mapping, import_report=report)
    try:
        assert _rows(db, 'SELECT activity, "Activity_attr", "Status", "status_2" FROM events') == [
            ("A", "x", "open", "o")
        ]
    finally:
        db.close()
    assert report["renamed_attributes"] == {"Activity": "Activity_attr", "status": "status_2"}


def test_auto_reads_the_whole_column_with_one_format(tmp_path):
    # 13/03 only fits day-first, 03/14 only month-first; reading each row with
    # whatever fits mixed both orders in one column.
    path = _csv(tmp_path, "case;act;ts\nc1;A;13/03/2024 10:00:00\nc1;B;14/03/2024 10:00:00\nc1;C;03/15/2024 10:00:00\n")
    report = {}
    db = import_ocel_db(path, mapping={"delimiter": ";", "columns": BASE_COLS}, import_report=report)
    try:
        assert [r[0] for r in _rows(db, "SELECT activity FROM events ORDER BY 1")] == ["A", "B"]
    finally:
        db.close()
    assert report["timestamp_format"] == "dd/MM/yyyy HH:mm:ss"
    assert report["skipped_bad_timestamp"] == 1
    assert report["bad_timestamp_example"] == "03/15/2024 10:00:00"


def test_ambiguous_day_month_order_is_flagged():
    from totem_lib.ocel.flat_log import check_timestamp_format

    check = check_timestamp_format(["03/04/2024 10:00:00", "05/06/2024 11:00:00"], "auto")
    assert check["format"] == "dd/MM/yyyy HH:mm:ss"
    assert check["results"][0] == "2024-04-03T10:00:00+00:00"
    (alt,) = check["ambiguous_with"]
    assert alt["format"] == "MM/dd/yyyy HH:mm:ss"
    assert alt["as_other"] == "2024-03-04T10:00:00+00:00"
    # Unambiguous samples, and ISO read two equivalent ways, are not flagged.
    assert check_timestamp_format(["13/04/2024 10:00:00"], "auto")["ambiguous_with"] == []
    assert check_timestamp_format(["2024-03-01 10:00:00"], "auto")["ambiguous_with"] == []


def test_windows_1252_csv_is_detected(tmp_path):
    from totem_lib.ocel.flat_log import detect_encoding

    text = "case;act;ts;Größe\nc1;Prüfung;2024-01-01;groß\n"
    preview = preview_flat_log(text.encode("cp1252"), "x.csv")
    assert preview["encoding"] == "windows-1252"
    assert [c["name"] for c in preview["columns"]][-1] == "Größe"
    db = import_ocel_db(_csv(tmp_path, text, "cp1252"), mapping={"delimiter": ";", "columns": BASE_COLS})
    try:
        assert _rows(db, "SELECT activity FROM events") == [("Prüfung",)]
    finally:
        db.close()
    assert detect_encoding("Größe".encode("utf-8")) == "utf-8-sig"
    assert detect_encoding("﻿a;b".encode("utf-16")) == "utf-16"
    # A sample cut inside a multi-byte character is still UTF-8.
    assert detect_encoding("aaö".encode("utf-8")[:-1]) == "utf-8-sig"


def test_utf16_excel_export_and_explicit_encoding(tmp_path):
    text = "case\tact\tts\nc1\tPrüfung\t2024-01-01\n"
    path = _csv(tmp_path, text, "utf-16", name="log.txt")
    db = import_ocel_db(path, mapping={"columns": BASE_COLS})
    try:
        assert _rows(db, "SELECT activity FROM events") == [("Prüfung",)]
    finally:
        db.close()
    with pytest.raises(FlatLogMappingError, match="Unknown text encoding"):
        FlatLogMapping.from_dict({"encoding": "klingon", "columns": BASE_COLS})


def test_cells_over_128_kb_import(tmp_path):
    path = _csv(tmp_path, "case;act;ts;note\nc1;A;2024-01-01;" + "x" * 300_000 + "\n")
    mapping = {"delimiter": ";", "columns": BASE_COLS + [{"column": "note", "role": "event_attribute"}]}
    db = import_ocel_db(path, mapping=mapping)
    try:
        assert _rows(db, "SELECT length(note) FROM events") == [(300_000,)]
    finally:
        db.close()


def test_gzip_preview_does_not_inflate_without_limit():
    from totem_lib.ocel import flat_log

    # About 1 GB of zeros after a valid XES start compresses to ~1 MB.
    header = XES.read_bytes()[:2000]
    compressor = __import__("zlib").compressobj(9, 8, 31)
    blob = compressor.compress(header)
    chunk = b"\0" * (1 << 20)
    for _ in range(1024):
        blob += compressor.compress(chunk)
    blob += compressor.flush()
    assert len(blob) < 2 * 1024 * 1024

    inflated, cut = flat_log._decompress_prefix(blob)
    assert cut and len(inflated) <= flat_log.PREVIEW_MAX_DECOMPRESSED
    preview = preview_flat_log(blob, "bomb.xes.gz")
    assert preview["truncated"] is True
