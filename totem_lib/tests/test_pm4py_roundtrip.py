import unittest
import pandas as pd
import polars as pl
from totem_lib.pm4py_adapter import convert_ocel_polars_to_pm4py, convert_pm4py_to_ocel_polars
from totem_lib import ObjectCentricEventLog
from pm4py.objects.ocel.obj import OCEL
import datetime

class TestPM4PyRoundTrip(unittest.TestCase):
    def test_round_trip(self):
        print("Creating dummy Totem OCEL...")
        # 1. Create a dummy Totem OCEL
        # Note: Polars usually infers types, but we'll be explicit where it matters
        events_data = {
            "_eventId": ["e1", "e2"],
            "_activity": ["a1", "a2"],
            "_timestampUnix": [1000, 2000],
            "_objects": [["o1"], ["o2", "o3"]],
            "_qualifiers": [[None], [None, None]]
        }
        objects_data = {
            "_objId": ["o1", "o2", "o3"],
            "_objType": ["t1", "t2", "t2"],
            "_targetObjects": [[], ["o3"], []],
            "_qualifiers": [[], [None], []]
        }
        
        events_pl = pl.DataFrame(events_data).with_columns(
             pl.col("_timestampUnix").cast(pl.Int64)
        )
        objects_pl = pl.DataFrame(objects_data)
        
        totem_ocel = ObjectCentricEventLog(events=events_pl, objects=objects_pl)
        
        print("Converting to PM4Py object...")
        # 2. Convert to PM4Py
        pm4py_ocel = convert_ocel_polars_to_pm4py(totem_ocel)
        
        # Verify PM4Py structure
        self.assertIsInstance(pm4py_ocel, OCEL)
        self.assertEqual(len(pm4py_ocel.events), 2)
        self.assertEqual(len(pm4py_ocel.objects), 3)
        
        print("Converting back to Totem object...")
        # 3. Convert back to Totem
        totem_ocel_back = convert_pm4py_to_ocel_polars(pm4py_ocel)
        
        # 4. Compare
        print("Comparing results...")
        # Sort and compare events
        events_orig = totem_ocel.events.sort("_eventId")
        events_back = totem_ocel_back.events.sort("_eventId")
        
        self.assertEqual(events_orig.height, events_back.height)
        # Check columns
        self.assertEqual(events_orig["_eventId"].to_list(), events_back["_eventId"].to_list())
        self.assertEqual(events_orig["_activity"].to_list(), events_back["_activity"].to_list())
        self.assertEqual(events_orig["_timestampUnix"].to_list(), events_back["_timestampUnix"].to_list())
        
        # Check objects in events (need to sort lists to be sure, ensuring consistent order)
        # But for this simple case, order might be preserved or not depending on implementation group by.
        # convert_pm4py_to_ocel_polars uses list(x) after groupby, order depends on appearance in relations.
        # Relations came from exploding, so order should be preserved if not messed up by merge.
        
        objs_orig = events_orig["_objects"].to_list()
        objs_back = events_back["_objects"].to_list()
        
        # sorting inner lists for robust comparison
        objs_orig = [sorted(l) for l in objs_orig]
        objs_back = [sorted(l) for l in objs_back]
        self.assertEqual(objs_orig, objs_back)

        # Sort and compare objects
        objects_orig = totem_ocel.objects.sort("_objId")
        objects_back = totem_ocel_back.objects.sort("_objId")
        
        self.assertEqual(objects_orig.height, objects_back.height)
        self.assertEqual(objects_orig["_objId"].to_list(), objects_back["_objId"].to_list())
        self.assertEqual(objects_orig["_objType"].to_list(), objects_back["_objType"].to_list())
        
        t_objs_orig = objects_orig["_targetObjects"].to_list()
        t_objs_back = objects_back["_targetObjects"].to_list()
        t_objs_orig = [sorted(l) for l in t_objs_orig]
        t_objs_back = [sorted(l) for l in t_objs_back]
        self.assertEqual(t_objs_orig, t_objs_back)
        
        print("Verification successful!")

if __name__ == '__main__':
    try:
        t = TestPM4PyRoundTrip()
        t.test_round_trip()
    except Exception as e:
        import traceback
        traceback.print_exc()
