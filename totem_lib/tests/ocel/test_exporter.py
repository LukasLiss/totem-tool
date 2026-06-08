"""
Tests for the OCEL exporter, including round-trip fidelity
with the importer.
"""

import json
import os

import polars as pl
import pytest

from totem_lib.ocel import ObjectCentricEventLog
from totem_lib.ocel.exporter import (
    _infer_ocel_type,
    _unix_to_iso,
    export_ocel,
    export_ocel_to_json,
)
from totem_lib.ocel.importer import import_ocel, import_ocel_from_csv
from totem_lib.ocel.ocel import (
    EVENTS_SCHEMA,
    OBJECT_ATTRIBUTE_SCHEMA,
    OBJECTS_SCHEMA,
)

EXAMPLE_CSV_PATH = os.path.join(
    os.path.dirname(__file__),
    "../../example_data/toy_example_ocel2.csv",
)


@pytest.fixture
def ocel_log():
    """Loads the example CSV OCEL once per test."""
    return import_ocel_from_csv(EXAMPLE_CSV_PATH)


def _assert_logs_equivalent(
    original: ObjectCentricEventLog, reloaded: ObjectCentricEventLog
):
    """Asserts that two logs carry the same events, objects, types and o2o edges."""
    assert sorted(original.events["_eventId"].to_list()) == sorted(
        reloaded.events["_eventId"].to_list()
    )
    assert sorted(original.objects["_objId"].to_list()) == sorted(
        reloaded.objects["_objId"].to_list()
    )
    assert sorted(original.object_types) == sorted(reloaded.object_types)
    assert sorted(original.o2o_graph_edges) == sorted(reloaded.o2o_graph_edges)


class TestExportDispatch:
    """Tests for the top-level export_ocel dispatch function."""

    def test_unsupported_format_raises(self, ocel_log, tmp_path):
        with pytest.raises(ValueError, match="Unsupported file format"):
            export_ocel("out", ocel_log, file_format="xml", file_path=str(tmp_path))

    def test_returns_full_path(self, ocel_log, tmp_path):
        path = export_ocel("out", ocel_log, file_format="csv", file_path=str(tmp_path))
        assert path == os.path.join(str(tmp_path), "out.csv")
        assert os.path.isfile(path)

    def test_creates_missing_directory(self, ocel_log, tmp_path):
        target_dir = os.path.join(str(tmp_path), "nested", "dir")
        path = export_ocel("out", ocel_log, file_format="json", file_path=target_dir)
        assert os.path.isfile(path)


class TestJSONExport:
    """Tests for the JSON exporter."""

    def test_creates_file(self, ocel_log, tmp_path):
        path = os.path.join(str(tmp_path), "out.json")
        export_ocel_to_json(ocel_log, path)
        assert os.path.isfile(path)

    def test_has_ocel2_top_level_keys(self, ocel_log, tmp_path):
        path = os.path.join(str(tmp_path), "out.json")
        export_ocel_to_json(ocel_log, path)
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        assert set(data.keys()) == {"objectTypes", "eventTypes", "objects", "events"}

    def test_event_structure(self, ocel_log, tmp_path):
        path = os.path.join(str(tmp_path), "out.json")
        export_ocel_to_json(ocel_log, path)
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        event = data["events"][0]
        assert set(event.keys()) == {
            "id",
            "type",
            "time",
            "attributes",
            "relationships",
        }

    def test_object_attributes_carry_time(self, ocel_log, tmp_path):
        path = os.path.join(str(tmp_path), "out.json")
        export_ocel_to_json(ocel_log, path)
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        i1 = next(o for o in data["objects"] if o["id"] == "i1")
        assert len(i1["attributes"]) > 0
        for attr in i1["attributes"]:
            assert set(attr.keys()) == {"name", "value", "time"}

    def test_type_declarations_match_data(self, ocel_log, tmp_path):
        path = os.path.join(str(tmp_path), "out.json")
        export_ocel_to_json(ocel_log, path)
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        declared_obj_types = {t["name"] for t in data["objectTypes"]}
        assert declared_obj_types == set(ocel_log.object_types)

    def test_roundtrip_preserves_log(self, ocel_log, tmp_path):
        path = os.path.join(str(tmp_path), "out.json")
        export_ocel_to_json(ocel_log, path)
        reloaded = import_ocel(path)
        _assert_logs_equivalent(ocel_log, reloaded)


class TestExportWithoutAttributesColumn:
    """The JSON/XML/SQLite importers omit the optional ``_attributes`` column;
    the exporters must still work when it is absent."""

    @pytest.fixture
    def ocel_no_attr_col(self, ocel_log):
        events_without_attrs = ocel_log.events.drop("_attributes")
        return ObjectCentricEventLog(
            events=events_without_attrs,
            objects=ocel_log.objects,
            object_attributes=ocel_log.object_attributes,
        )

    def test_json_export_without_attributes_column(self, ocel_no_attr_col, tmp_path):
        path = os.path.join(str(tmp_path), "out.json")
        export_ocel_to_json(ocel_no_attr_col, path)
        reloaded = import_ocel(path)
        _assert_logs_equivalent(ocel_no_attr_col, reloaded)


class TestTimestampFormatting:
    """Tests for the _unix_to_iso helper."""

    def test_formats_utc_iso(self):
        # 1684756482 -> 2023-05-22T11:54:42Z
        assert _unix_to_iso(1684756482) == "2023-05-22T11:54:42.000Z"

    def test_none_timestamp_raises(self):
        with pytest.raises(ValueError, match="non-null timestamps"):
            _unix_to_iso(None)


class TestAttributeTypeInference:
    """Event/object attribute types in JSON must reflect the value type, not
    always 'string' (OCEL 2.0: string, time, integer, float, boolean)."""

    def test_infer_ocel_type(self):
        # bool must be checked before int (bool is a subclass of int)
        assert _infer_ocel_type(True) == "boolean"
        assert _infer_ocel_type(42) == "integer"
        assert _infer_ocel_type(3.14) == "float"
        assert _infer_ocel_type("hi") == "string"

    @pytest.fixture
    def typed_ocel(self):
        events = pl.DataFrame(
            [
                {
                    "_eventId": "e1",
                    "_activity": "pay",
                    "_timestampUnix": 1000,
                    "_objects": ["o1"],
                    "_qualifiers": [""],
                    "_attributes": json.dumps(
                        {"amount": 42, "paid": True, "rate": 2.5, "note": "hi"}
                    ),
                }
            ],
            schema=EVENTS_SCHEMA,
        )
        objects = pl.DataFrame(
            [
                {
                    "_objId": "o1",
                    "_objType": "order",
                    "_targetObjects": [],
                    "_qualifiers": [],
                }
            ],
            schema=OBJECTS_SCHEMA,
        )
        object_attributes = pl.DataFrame(
            [
                {
                    "_objId": "o1",
                    "_timestampUnix": 1000,
                    "_jsonObjAttributes": json.dumps({"weight": 3.0, "count": 7}),
                }
            ],
            schema=OBJECT_ATTRIBUTE_SCHEMA,
        )
        return ObjectCentricEventLog(
            events=events, objects=objects, object_attributes=object_attributes
        )

    def test_event_attribute_types(self, typed_ocel, tmp_path):
        path = os.path.join(str(tmp_path), "typed.json")
        export_ocel_to_json(typed_ocel, path)
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        attrs = {a["name"]: a["type"] for a in data["eventTypes"][0]["attributes"]}
        assert attrs == {
            "amount": "integer",
            "paid": "boolean",
            "rate": "float",
            "note": "string",
        }

    def test_object_attribute_types(self, typed_ocel, tmp_path):
        path = os.path.join(str(tmp_path), "typed.json")
        export_ocel_to_json(typed_ocel, path)
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        attrs = {a["name"]: a["type"] for a in data["objectTypes"][0]["attributes"]}
        assert attrs == {"weight": "float", "count": "integer"}

    def test_conflicting_types_widen_to_string(self, tmp_path):
        # The same attribute appears as int and as str across two events of one
        # activity -> the declared type must widen to "string".
        events = pl.DataFrame(
            [
                {
                    "_eventId": "e1",
                    "_activity": "a",
                    "_timestampUnix": 1,
                    "_objects": [],
                    "_qualifiers": [],
                    "_attributes": json.dumps({"x": 1}),
                },
                {
                    "_eventId": "e2",
                    "_activity": "a",
                    "_timestampUnix": 2,
                    "_objects": [],
                    "_qualifiers": [],
                    "_attributes": json.dumps({"x": "str"}),
                },
            ],
            schema=EVENTS_SCHEMA,
        )
        ocel = ObjectCentricEventLog(
            events=events, objects=pl.DataFrame([], schema=OBJECTS_SCHEMA)
        )
        path = os.path.join(str(tmp_path), "conflict.json")
        export_ocel_to_json(ocel, path)
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        assert data["eventTypes"][0]["attributes"][0]["type"] == "string"
