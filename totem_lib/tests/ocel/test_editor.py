"""
Tests for the OCEL editor (`totem_lib.ocel.editor.OcelEditor`).

Covers the whole editor surface the backend exposes:

- creating an empty working log from scratch and building it up via CRUD,
- creating a working copy from a `.duckdb` source and from an OCEL 2.0
  source that goes through the streaming importer,
- pagination / filtering / sorting of the events, objects and O2O listings,
- attribute editing including dynamic column creation and the
  `object_attribute_history` mirror that keeps exports lossless,
- LaTeX export of the E2O and O2O tables,
- file export to duckdb / sqlite / json / xml with re-import round-trips.
"""

from __future__ import annotations

import sys
from pathlib import Path

import duckdb
import pytest

# Make the totem_lib `src` layout importable in raw-pytest invocations.
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))

from totem_lib.ocel.editor import OcelEditor, OcelEditorError, latex_escape
from totem_lib.ocel.importer_db import import_ocel_db

TEST_DATA = Path(__file__).parent.parent.parent / "test_data" / "small"
DUCKDB_SOURCE = TEST_DATA / "container_logistics.duckdb"


@pytest.fixture()
def editor(tmp_path) -> OcelEditor:
    """Empty editor seeded with the small radio-production example."""
    ed = OcelEditor.create_empty(str(tmp_path / "work.duckdb"))
    ed.create_object("o1", "order")
    ed.create_object("r1", "radio")
    ed.create_object("w1", "worker")
    ed.create_event(
        "e1", "receive order", 100, objects=[{"object_id": "o1"}]
    )
    ed.create_event(
        "e2",
        "produce radio parts",
        200,
        objects=[{"object_id": "r1"}, {"object_id": "w1", "qualifier": "operator"}],
    )
    ed.create_event(
        "e3",
        "fulfill order",
        300,
        objects=[{"object_id": "o1"}, {"object_id": "r1"}],
    )
    ed.set_relation("r1", "o1", "fulfills")
    yield ed
    ed.close()


# ---------------------------------------------------------------------------
# Construction
# ---------------------------------------------------------------------------


def test_create_empty_has_valid_schema(tmp_path):
    ed = OcelEditor.create_empty(str(tmp_path / "empty.duckdb"))
    summary = ed.summary()
    assert summary["num_events"] == 0
    assert summary["num_objects"] == 0
    assert summary["object_types"] == []
    ed.close()


def test_create_empty_refuses_existing_file(tmp_path):
    path = tmp_path / "exists.duckdb"
    path.write_bytes(b"")
    with pytest.raises(OcelEditorError):
        OcelEditor.create_empty(str(path))


def test_from_source_duckdb_copy(tmp_path):
    ed = OcelEditor.from_source(str(DUCKDB_SOURCE), str(tmp_path / "copy.duckdb"))
    src = duckdb.connect(str(DUCKDB_SOURCE), read_only=True)
    expected = src.execute("SELECT COUNT(*) FROM events").fetchone()[0]
    src.close()
    assert ed.summary()["num_events"] == expected
    # The copy is independent of the source.
    first = ed.list_events(page=1, page_size=1)["items"][0]
    ed.delete_event(first["id"])
    assert ed.summary()["num_events"] == expected - 1
    ed.close()
    src = duckdb.connect(str(DUCKDB_SOURCE), read_only=True)
    assert src.execute("SELECT COUNT(*) FROM events").fetchone()[0] == expected
    src.close()


def test_from_source_rejects_non_ocel_duckdb(tmp_path):
    stray = tmp_path / "stray.duckdb"
    conn = duckdb.connect(str(stray))
    conn.execute("CREATE TABLE foo (a INTEGER)")
    conn.close()
    with pytest.raises(OcelEditorError, match="missing tables"):
        OcelEditor.from_source(str(stray), str(tmp_path / "copy.duckdb"))


def test_from_source_rejects_unknown_extension(tmp_path):
    src = tmp_path / "log.txt"
    src.write_text("nope")
    with pytest.raises(OcelEditorError, match="Unsupported file type"):
        OcelEditor.from_source(str(src), str(tmp_path / "copy.duckdb"))


# ---------------------------------------------------------------------------
# Event CRUD + E2O
# ---------------------------------------------------------------------------


def test_event_crud_roundtrip(editor):
    created = editor.create_event(
        "e4",
        "ship radio",
        400,
        attributes={"cost": "12.5"},
        objects=[{"object_id": "r1", "qualifier": "shipped"}],
    )
    assert created["attributes"] == {"cost": "12.5"}
    assert created["objects"] == [
        {"object_id": "r1", "object_type": "radio", "qualifier": "shipped"}
    ]

    updated = editor.update_event(
        "e4",
        new_event_id="e4b",
        activity="ship radio fast",
        timestamp=450,
        attributes={"cost": "13"},
        objects=[{"object_id": "o1"}],
    )
    assert updated["id"] == "e4b"
    assert updated["activity"] == "ship radio fast"
    assert updated["timestamp"] == 450
    assert updated["attributes"] == {"cost": "13"}
    assert [o["object_id"] for o in updated["objects"]] == ["o1"]

    editor.delete_event("e4b")
    with pytest.raises(OcelEditorError, match="not found"):
        editor.get_event("e4b")


def test_create_event_validations(editor):
    with pytest.raises(OcelEditorError, match="already exists"):
        editor.create_event("e1", "x", 1)
    with pytest.raises(OcelEditorError, match="does not exist"):
        editor.create_event("e9", "x", 1, objects=[{"object_id": "ghost"}])
    with pytest.raises(OcelEditorError, match="non-empty"):
        editor.create_event("", "x", 1)
    with pytest.raises(OcelEditorError, match="Timestamp"):
        editor.create_event("e9", "x", "not-a-number")
    with pytest.raises(OcelEditorError, match="more than once"):
        editor.create_event(
            "e9", "x", 1, objects=[{"object_id": "o1"}, {"object_id": "o1"}]
        )


def test_clearing_attribute_removes_value(editor):
    editor.create_event("e5", "pack", 500, attributes={"cost": "1"})
    updated = editor.update_event("e5", attributes={})
    assert updated["attributes"] == {}


def test_list_events_pagination_sort_filter(editor):
    result = editor.list_events(page=1, page_size=2, sort_by="timestamp")
    assert result["total"] == 3
    assert [e["id"] for e in result["items"]] == ["e1", "e2"]
    result = editor.list_events(page=2, page_size=2, sort_by="timestamp")
    assert [e["id"] for e in result["items"]] == ["e3"]

    desc = editor.list_events(sort_by="timestamp", sort_dir="desc")
    assert [e["id"] for e in desc["items"]] == ["e3", "e2", "e1"]

    assert editor.list_events(search="ORDER")["total"] == 2
    assert editor.list_events(activity="fulfill order")["total"] == 1
    assert editor.list_events(object_type="worker")["total"] == 1
    assert editor.list_events(object_id="o1")["total"] == 2


# ---------------------------------------------------------------------------
# Object CRUD + attributes + O2O
# ---------------------------------------------------------------------------


def test_object_crud_roundtrip(editor):
    created = editor.create_object(
        "r2",
        "radio",
        attributes={"color": "black"},
        relations=[{"target": "w1", "qualifier": "built by"}],
    )
    assert created["attributes"] == {"color": "black"}
    assert created["relations"] == [{"target": "w1", "qualifier": "built by"}]

    updated = editor.update_object(
        "r2", new_obj_id="r2b", obj_type="premium radio", attributes={"color": "red"}
    )
    assert updated["id"] == "r2b"
    assert updated["type"] == "premium radio"
    assert updated["attributes"] == {"color": "red"}
    # Rename cascaded into the relations table.
    assert updated["relations"] == [{"target": "w1", "qualifier": "built by"}]

    editor.delete_object("r2b")
    with pytest.raises(OcelEditorError, match="not found"):
        editor.get_object("r2b")


def test_object_rename_cascades_to_events_and_relations(editor):
    editor.update_object("o1", new_obj_id="order-1")
    event = editor.get_event("e1")
    assert [o["object_id"] for o in event["objects"]] == ["order-1"]
    relations = editor.list_relations()["items"]
    assert {(r["source"], r["target"]) for r in relations} == {("r1", "order-1")}


def test_delete_object_cleans_up_references(editor):
    editor.delete_object("o1")
    assert editor.get_event("e1")["objects"] == []
    assert editor.list_relations()["total"] == 0


def test_object_attributes_mirrored_into_history(editor):
    editor.update_object("r1", attributes={"color": "black"})
    rows = editor.conn.execute(
        'SELECT obj_id, "color" FROM object_attribute_history'
    ).fetchall()
    assert ("r1", "black") in rows
    # Updating again replaces the snapshot instead of stacking duplicates.
    editor.update_object("r1", attributes={"color": "red"})
    rows = editor.conn.execute(
        'SELECT COUNT(*) FROM object_attribute_history WHERE obj_id = ?', ["r1"]
    ).fetchone()
    assert rows[0] == 1


def test_invalid_attribute_name_rejected(editor):
    with pytest.raises(OcelEditorError, match="Invalid attribute name"):
        editor.update_object("r1", attributes={'bad"name': "x"})


def test_list_objects_filter_and_event_count(editor):
    result = editor.list_objects(object_type="order")
    assert result["total"] == 1
    assert result["items"][0]["event_count"] == 2
    assert editor.list_objects(search="r1")["total"] == 1


# ---------------------------------------------------------------------------
# O2O relations
# ---------------------------------------------------------------------------


def test_relations_upsert_and_delete(editor):
    editor.set_relation("w1", "r1", "assembles")
    assert editor.list_relations()["total"] == 2
    # Upsert replaces the qualifier instead of failing on the PK.
    editor.set_relation("w1", "r1", "builds")
    rels = {(r["source"], r["target"]): r["qualifier"] for r in editor.list_relations()["items"]}
    assert rels[("w1", "r1")] == "builds"

    editor.delete_relation("w1", "r1")
    assert editor.list_relations()["total"] == 1
    with pytest.raises(OcelEditorError, match="not found"):
        editor.delete_relation("w1", "r1")


def test_relation_validations(editor):
    with pytest.raises(OcelEditorError, match="different objects"):
        editor.set_relation("o1", "o1")
    with pytest.raises(OcelEditorError, match="does not exist"):
        editor.set_relation("o1", "ghost")


# ---------------------------------------------------------------------------
# LaTeX export
# ---------------------------------------------------------------------------


def test_latex_e2o_structure(editor):
    result = editor.latex_e2o()
    latex = result["latex"]
    assert result["truncated"] is False
    assert "\\usepackage{multirow}" in latex
    assert "\\begin{tabular}{|l|l|l|lll|}" in latex
    assert "\\multicolumn{3}{l|}{object types}" in latex
    assert "\\cline{4-6}" in latex
    # e3 relates to order and radio but not worker → worker column empty.
    e3_line = next(line for line in latex.splitlines() if line.startswith("e3"))
    assert "\\multicolumn{1}{l|}{o1}" in e3_line
    assert "\\multicolumn{1}{l|}{r1}" in e3_line
    assert e3_line.rstrip().endswith("\\\\ \\hline")


def test_latex_e2o_escapes_special_characters(editor):
    editor.create_object("o_2", "order")
    editor.create_event("e_9", "50% & done", 900, objects=[{"object_id": "o_2"}])
    latex = editor.latex_e2o()["latex"]
    assert "50\\% \\& done" in latex
    assert "e\\_9" in latex


def test_latex_o2o(editor):
    latex = editor.latex_o2o()["latex"]
    assert "\\begin{tabular}{|l|l|l|}" in latex
    assert "r1 & o1 & fulfills \\\\ \\hline" in latex


def test_latex_escape():
    assert latex_escape("a_b & 100% #1 {x}") == "a\\_b \\& 100\\% \\#1 \\{x\\}"


def test_latex_truncation(editor):
    result = editor.latex_e2o(max_rows=1)
    assert result["rows"] == 1
    assert result["truncated"] is True


# ---------------------------------------------------------------------------
# File export
# ---------------------------------------------------------------------------


def test_export_duckdb_roundtrip(editor, tmp_path):
    dest = tmp_path / "export.duckdb"
    editor.export(str(dest), "duckdb")
    reopened = OcelEditor(str(dest))
    assert reopened.summary()["num_events"] == 3
    assert reopened.summary()["num_o2o"] == 1
    reopened.close()


def test_export_ocel2_sqlite(editor, tmp_path):
    """Verify the sqlite export with stdlib sqlite3 — re-importing through
    DuckDB would need the sqlite_scanner extension (network download)."""
    import sqlite3

    editor.update_object("r1", attributes={"color": "black"})
    editor.update_event("e1", attributes={"cost": "9"})
    dest = tmp_path / "export.sqlite"
    editor.export(str(dest), "sqlite")

    conn = sqlite3.connect(str(dest))
    tables = {
        r[0]
        for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        ).fetchall()
    }
    assert {"event", "object", "event_object", "object_object"} <= tables
    assert conn.execute("SELECT COUNT(*) FROM event").fetchone()[0] == 3
    assert conn.execute("SELECT COUNT(*) FROM object").fetchone()[0] == 3
    assert conn.execute("SELECT COUNT(*) FROM object_object").fetchone()[0] == 1
    # Attribute columns survived the pm4py conversion.
    color = conn.execute(
        'SELECT "color" FROM object_radio WHERE ocel_id = ?', ["r1"]
    ).fetchone()
    assert color and color[0] == "black"
    conn.close()


@pytest.mark.parametrize("fmt,ext", [("json", ".json"), ("xml", ".xml")])
def test_export_ocel2_roundtrip(editor, fmt, ext, tmp_path):
    editor.update_object("r1", attributes={"color": "black"})
    editor.update_event("e1", attributes={"cost": "9"})
    dest = tmp_path / f"export{ext}"
    editor.export(str(dest), fmt)
    assert dest.exists() and dest.stat().st_size > 0

    reimported = import_ocel_db(str(dest))
    n_events = reimported.conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
    n_objects = reimported.conn.execute("SELECT COUNT(*) FROM objects").fetchone()[0]
    assert n_events == 3
    assert n_objects == 3
    activities = {
        r[0]
        for r in reimported.conn.execute("SELECT DISTINCT activity FROM events").fetchall()
    }
    assert activities == {"receive order", "produce radio parts", "fulfill order"}
    reimported.close()


def test_export_rejects_unknown_format(editor, tmp_path):
    with pytest.raises(OcelEditorError, match="Unsupported export format"):
        editor.export(str(tmp_path / "x.bin"), "bin")
