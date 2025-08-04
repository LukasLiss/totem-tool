from django.test import TestCase
from ocel.utils import load_events_from_sqlite, load_objects_from_sqlite, load_events_from_json, load_objects_from_json, load_events_from_xml, load_objects_from_xml
import polars as pl

# Create your tests here.
class ImporterTests(TestCase):

    def setUp(self):
        # This method is called before each test
        pass

    def test_sqlite_import_events(self):
        events_df = load_events_from_sqlite("ocel/resources/ContainerLogistics.sqlite")
        self.assertIsNotNone(events_df)
        self.assertTrue(events_df.shape[0] == 35413)

        self.assertEqual(["_eventId", "_activity", "_timestampUnix", "_objects"], events_df.columns)
        # self.assertIs(events_df["_objects"].dtype, pl.List(pl.String))
        # self.assertIs(events_df["_timestampUnix"].dtype, pl.Int64)

        # row with no objects should have an empty list
        # example_row = events_df.filter(pl.col("_eventId") == "collect_hu10533")
        # self.assertListEqual(example_row["_objects"].item(0), [])

    def test_sqlite_import_objects(self):
        objects_df = load_objects_from_sqlite("ocel/resources/ContainerLogistics.sqlite")
        self.assertIsNotNone(objects_df)
        self.assertTrue(objects_df.shape[0] == 13910)

    def test_json_import_events(self):
        events_df = load_events_from_json("ocel/resources/ContainerLogistics.json")
        self.assertIsNotNone(events_df)
        self.assertTrue(events_df.shape[0] == 35413)

        self.assertEqual(["_eventId", "_activity", "_timestampUnix", "_objects"], events_df.columns)

    def test_json_import_objects(self):
        objects_df = load_objects_from_json("ocel/resources/ContainerLogistics.json")
        self.assertIsNotNone(objects_df)
        self.assertTrue(objects_df.shape[0] == 13910)

    def test_xml_import_events(self):
        events_df = load_events_from_xml("ocel/resources/ContainerLogistics.xml")
        self.assertIsNotNone(events_df)
        self.assertTrue(events_df.shape[0] == 35413)

        self.assertEqual(["_eventId", "_activity", "_timestampUnix", "_objects"], events_df.columns)

    def test_xml_import_objects(self):
        objects_df = load_objects_from_xml("ocel/resources/ContainerLogistics.xml")
        self.assertIsNotNone(objects_df)
        self.assertTrue(objects_df.shape[0] == 13910)
