"""
Tests for the OCEL exporter (CSV and JSON), including round-trip fidelity
with the importer.
"""
import json
import os

import pytest

from totem_lib.ocel.importer import import_ocel, import_ocel_from_csv
from totem_lib.ocel.exporter import (
    export_ocel,
    export_ocel_to_csv,
    export_ocel_to_json,
)
from totem_lib.ocel import ObjectCentricEventLog


EXAMPLE_CSV_PATH = os.path.join(
    os.path.dirname(__file__),
    "../../example_data/toy_example_ocel2.csv",
)


@pytest.fixture
def ocel_log():
    """Loads the example CSV OCEL once per test."""
    return import_ocel_from_csv(EXAMPLE_CSV_PATH)


def _assert_logs_equivalent(original: ObjectCentricEventLog, reloaded: ObjectCentricEventLog):
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


class TestCSVExport:
    """Tests for the CSV exporter."""

    def test_creates_file(self, ocel_log, tmp_path):
        path = os.path.join(str(tmp_path), "out.csv")
        export_ocel_to_csv(ocel_log, path)
        assert os.path.isfile(path)

    def test_header_has_expected_columns(self, ocel_log, tmp_path):
        path = os.path.join(str(tmp_path), "out.csv")
        export_ocel_to_csv(ocel_log, path)
        with open(path, encoding="utf-8") as f:
            header = f.readline().strip().split(",")
        assert header[:3] == ["id", "activity", "timestamp"]
        assert any(c.startswith("ot:") for c in header)
        assert any(c.startswith("ea:") for c in header)

    def test_roundtrip_preserves_log(self, ocel_log, tmp_path):
        path = os.path.join(str(tmp_path), "out.csv")
        export_ocel_to_csv(ocel_log, path)
        reloaded = import_ocel_from_csv(path)
        _assert_logs_equivalent(ocel_log, reloaded)

    def test_roundtrip_preserves_event_attributes(self, ocel_log, tmp_path):
        path = os.path.join(str(tmp_path), "out.csv")
        export_ocel_to_csv(ocel_log, path)
        reloaded = import_ocel_from_csv(path)
        # e2 has billable=no and area=outdoor in the example file
        assert reloaded.get_event_attribute_value("e2", "billable") == "no"
        assert reloaded.get_event_attribute_value("e2", "area") == "outdoor"

    def test_roundtrip_preserves_object_attributes(self, ocel_log, tmp_path):
        path = os.path.join(str(tmp_path), "out.csv")
        export_ocel_to_csv(ocel_log, path)
        reloaded = import_ocel_from_csv(path)
        # i1's price is updated to "50€" by the last update in the example file
        assert reloaded.get_object_attribute_value("i1", "price") == "50€"


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
        assert set(event.keys()) == {"id", "type", "time", "attributes", "relationships"}

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

    def test_csv_export_without_attributes_column(self, ocel_no_attr_col, tmp_path):
        path = os.path.join(str(tmp_path), "out.csv")
        export_ocel_to_csv(ocel_no_attr_col, path)
        reloaded = import_ocel_from_csv(path)
        _assert_logs_equivalent(ocel_no_attr_col, reloaded)

    def test_json_export_without_attributes_column(self, ocel_no_attr_col, tmp_path):
        path = os.path.join(str(tmp_path), "out.json")
        export_ocel_to_json(ocel_no_attr_col, path)
        reloaded = import_ocel(path)
        _assert_logs_equivalent(ocel_no_attr_col, reloaded)
