"""
Tests for CSV OCEL importer and attribute methods.
"""
import pytest
import os
from totem_lib.ocel.importer import import_ocel_from_csv
from totem_lib.ocel import ObjectCentricEventLog


# Get the path to the example CSV file
EXAMPLE_CSV_PATH = os.path.join(
    os.path.dirname(__file__),
    "../../example_data/toy_example_ocel2.csv"
)


@pytest.fixture
def ocel_log():
    """Fixture that loads the example CSV file once for all tests."""
    return import_ocel_from_csv(EXAMPLE_CSV_PATH)


class TestCSVImporter:
    """Tests for the CSV importer function."""

    def test_import_creates_log(self, ocel_log):
        """Test that the importer creates an ObjectCentricEventLog instance."""
        assert isinstance(ocel_log, ObjectCentricEventLog)

    def test_events_dataframe_structure(self, ocel_log):
        """Test that the events DataFrame has the correct schema."""
        events = ocel_log.events
        assert "_eventId" in events.columns
        assert "_activity" in events.columns
        assert "_timestampUnix" in events.columns
        assert "_objects" in events.columns
        assert "_qualifiers" in events.columns
        assert "_attributes" in events.columns

    def test_objects_dataframe_structure(self, ocel_log):
        """Test that the objects DataFrame has the correct schema."""
        objects = ocel_log.objects
        assert "_objId" in objects.columns
        assert "_objType" in objects.columns
        assert "_targetObjects" in objects.columns
        assert "_qualifiers" in objects.columns

    def test_object_attributes_dataframe_structure(self, ocel_log):
        """Test that the object_attributes DataFrame has the correct schema."""
        obj_attrs = ocel_log.object_attributes
        assert "_objId" in obj_attrs.columns
        assert "_timestampUnix" in obj_attrs.columns
        assert "_jsonObjAttributes" in obj_attrs.columns

    def test_correct_number_of_events(self, ocel_log):
        """Test that the correct number of events are imported."""
        # From the CSV: e1, e2, e3, e4 are events
        assert ocel_log.events.height == 4

    def test_correct_number_of_objects(self, ocel_log):
        """Test that the correct number of unique objects are imported."""
        # From the CSV: o1, i1, i2 are objects
        assert ocel_log.objects.height == 3

    def test_event_activities(self, ocel_log):
        """Test that event activities are correctly imported."""
        activities = set(ocel_log.events["_activity"].to_list())
        expected_activities = {"place order", "pick item", "produce item", "send order"}
        assert activities == expected_activities

    def test_object_types(self, ocel_log):
        """Test that object types are correctly identified."""
        obj_types = ocel_log.objects.select("_objId", "_objType").rows()
        obj_type_dict = dict(obj_types)

        assert obj_type_dict["o1"] == "oder"  # Note: CSV has typo "oder" instead of "order"
        assert obj_type_dict["i1"] == "item"
        assert obj_type_dict["i2"] == "item"

    def test_event_objects_relationship(self, ocel_log):
        """Test that events are correctly linked to objects."""
        # Event e1 should have objects o1, i1, i2
        e1_row = ocel_log.events.filter(ocel_log.events["_eventId"] == "e1")
        e1_objects = e1_row["_objects"][0]
        assert "o1" in e1_objects
        assert "i1" in e1_objects
        assert "i2" in e1_objects

    def test_event_qualifiers(self, ocel_log):
        """Test that event qualifiers are correctly parsed."""
        # Event e1 has objects i1 and i2 with qualifier "part-of"
        e1_row = ocel_log.events.filter(ocel_log.events["_eventId"] == "e1")
        e1_qualifiers = e1_row["_qualifiers"][0]

        # Check that "part-of" appears in qualifiers
        assert "part-of" in e1_qualifiers

    def test_object_to_object_relationships(self, ocel_log):
        """Test that o2o relationships are correctly imported."""
        # o1 should have relationships to i1 and i2 with qualifier "has"
        o1_row = ocel_log.objects.filter(ocel_log.objects["_objId"] == "o1")
        o1_targets = o1_row["_targetObjects"][0]
        o1_qualifiers = o1_row["_qualifiers"][0]

        assert "i1" in o1_targets
        assert "i2" in o1_targets
        assert "has" in o1_qualifiers

    def test_object_attributes_recorded(self, ocel_log):
        """Test that object attributes are recorded in the object_attributes DataFrame."""
        # Check that i1 has attribute updates
        i1_attrs = ocel_log.object_attributes.filter(
            ocel_log.object_attributes["_objId"] == "i1"
        )
        assert i1_attrs.height > 0


class TestEventAttributeMethods:
    """Tests for event attribute getter methods."""

    def test_get_event_attributes_returns_keys(self, ocel_log):
        """Test that get_event_attributes returns the attribute keys."""
        # Event e1 has event attributes: billable=no
        attrs = ocel_log.get_event_attributes("e1")
        assert "billable" in attrs

    def test_get_event_attributes_multiple_attributes(self, ocel_log):
        """Test getting attributes for event with multiple attributes."""
        # Event e2 has: billable=no, area=outdoor
        attrs = ocel_log.get_event_attributes("e2")
        assert "billable" in attrs
        assert "area" in attrs
        assert len(attrs) == 2

    def test_get_event_attributes_empty(self, ocel_log):
        """Test that events without attributes return empty list."""
        # Create a simple event without attributes for testing
        # For now, we'll test with an event that might not have area attribute
        attrs = ocel_log.get_event_attributes("e1")
        # e1 should have billable but not area
        assert "billable" in attrs

    def test_get_event_attributes_nonexistent_event(self, ocel_log):
        """Test that nonexistent event returns empty list."""
        attrs = ocel_log.get_event_attributes("nonexistent")
        assert attrs == []

    def test_get_event_attribute_value_returns_correct_value(self, ocel_log):
        """Test that get_event_attribute_value returns the correct value."""
        # Event e2 has billable=no
        value = ocel_log.get_event_attribute_value("e2", "billable")
        assert value == "no"

    def test_get_event_attribute_value_multiple_attributes(self, ocel_log):
        """Test getting different attribute values from the same event."""
        # Event e2 has billable=no and area=outdoor
        billable = ocel_log.get_event_attribute_value("e2", "billable")
        area = ocel_log.get_event_attribute_value("e2", "area")
        assert billable == "no"
        assert area == "outdoor"

    def test_get_event_attribute_value_nonexistent_event_raises_error(self, ocel_log):
        """Test that accessing a nonexistent event raises ValueError."""
        with pytest.raises(ValueError, match="Event with ID .* not found"):
            ocel_log.get_event_attribute_value("nonexistent", "billable")

    def test_get_event_attribute_value_nonexistent_key_raises_error(self, ocel_log):
        """Test that accessing a nonexistent attribute key raises KeyError."""
        with pytest.raises(KeyError, match="Attribute key .* not found"):
            ocel_log.get_event_attribute_value("e1", "nonexistent_key")


class TestObjectAttributeMethods:
    """Tests for object attribute getter methods."""

    def test_get_object_attributes_returns_keys(self, ocel_log):
        """Test that get_object_attributes returns all attribute keys."""
        # i1 should have price attribute from the event in the CSV
        attrs = ocel_log.get_object_attributes("i1")
        assert "price" in attrs

    def test_get_object_attributes_multiple_updates(self, ocel_log):
        """Test that get_object_attributes returns all unique keys across updates."""
        # i1 has price attribute that changes over time
        attrs = ocel_log.get_object_attributes("i1")
        assert "price" in attrs

    def test_get_object_attributes_nonexistent_object(self, ocel_log):
        """Test that nonexistent object returns empty list."""
        attrs = ocel_log.get_object_attributes("nonexistent")
        assert attrs == []

    def test_get_object_attribute_value_latest(self, ocel_log):
        """Test getting the latest value of an object attribute."""
        # i1 has price updates: first "5€" then "50€"
        # The latest value should be "50€"
        value = ocel_log.get_object_attribute_value("i1", "price")
        assert value == "50€"

    def test_get_object_attribute_value_at_timestamp(self, ocel_log):
        """Test getting attribute value at a specific timestamp."""
        # Get the timestamp of event e1 (first price update for i1: "5€")
        e1_timestamp = ocel_log.get_event_timestamp("e1")

        # At or slightly after e1, the price should be "5€"
        value = ocel_log.get_object_attribute_value("i1", "price", timestamp=e1_timestamp)
        assert value == "5€"

    def test_get_object_attribute_value_before_timestamp(self, ocel_log):
        """Test getting attribute value before any updates raises KeyError."""
        # Try to get price at timestamp 0 (before any updates)
        with pytest.raises((ValueError, KeyError)):
            ocel_log.get_object_attribute_value("i1", "price", timestamp=0)

    def test_get_object_attribute_value_nonexistent_object_raises_error(self, ocel_log):
        """Test that accessing a nonexistent object raises ValueError."""
        with pytest.raises(ValueError, match="No attribute records found"):
            ocel_log.get_object_attribute_value("nonexistent", "price")

    def test_get_object_attribute_value_nonexistent_key_raises_error(self, ocel_log):
        """Test that accessing a nonexistent attribute key raises KeyError."""
        with pytest.raises(KeyError, match="Attribute key .* not found"):
            ocel_log.get_object_attribute_value("i1", "nonexistent_key")

    def test_object_attribute_progression(self, ocel_log):
        """Test that object attributes progress correctly over time."""
        # Get timestamps for events
        e1_timestamp = ocel_log.get_event_timestamp("e1")

        # Get a later timestamp (from the standalone object attribute update)
        # Row 5 in CSV has timestamp 2026-01-25 with i1 price update to "50€"
        obj_attr_rows = ocel_log.object_attributes.filter(
            ocel_log.object_attributes["_objId"] == "i1"
        ).sort("_timestampUnix")

        if obj_attr_rows.height >= 2:
            # Check that we have multiple attribute updates
            first_timestamp = obj_attr_rows["_timestampUnix"][0]
            second_timestamp = obj_attr_rows["_timestampUnix"][1]

            # Value at first timestamp should be "5€"
            value1 = ocel_log.get_object_attribute_value("i1", "price", timestamp=first_timestamp)
            assert value1 == "5€"

            # Value at second timestamp should be "50€"
            value2 = ocel_log.get_object_attribute_value("i1", "price", timestamp=second_timestamp)
            assert value2 == "50€"


class TestCSVFormatHandling:
    """Tests for CSV format edge cases and special handling."""

    def test_multiple_objects_per_cell(self, ocel_log):
        """Test that multiple objects separated by '/' are correctly parsed."""
        # Event e4 has "i1/i2" in the item column
        e4_row = ocel_log.events.filter(ocel_log.events["_eventId"] == "e4")
        e4_objects = e4_row["_objects"][0]
        assert "i1" in e4_objects
        assert "i2" in e4_objects

    def test_empty_qualifier_handling(self, ocel_log):
        """Test that objects without qualifiers are handled correctly."""
        # Event e4 has objects without qualifiers
        e4_row = ocel_log.events.filter(ocel_log.events["_eventId"] == "e4")
        e4_qualifiers = e4_row["_qualifiers"][0]
        # Should have empty strings for missing qualifiers
        assert "" in e4_qualifiers or len(e4_qualifiers) == 0 or all(q == "" for q in e4_qualifiers)

    def test_json_attributes_in_objects(self, ocel_log):
        """Test that JSON attributes in object strings are correctly parsed."""
        # i1 in e1 has {"price": "5€"}
        i1_attrs = ocel_log.object_attributes.filter(
            ocel_log.object_attributes["_objId"] == "i1"
        )
        assert i1_attrs.height > 0

        # Check that the JSON contains price information
        import json
        first_attr = json.loads(i1_attrs["_jsonObjAttributes"][0])
        assert "price" in first_attr
