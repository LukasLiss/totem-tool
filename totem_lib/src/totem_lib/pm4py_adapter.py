import pandas as pd
import polars as pl
from functools import cached_property
from typing import Dict, List, Tuple

# TODO: add schemas
# (EVENTS_SCHEMA, OBJECTS_SCHEMA, ObjectCentricEventLog)

class PolarsOCELAdapter:
    """
    An adapter class to make the Polars-based ObjectCentricEventLog compatible
    with the pm4py library, which expects a Pandas-based interface.
    """
    # TODO: proofread and test this class
    def __init__(self, ocel: "ObjectCentricEventLog"):
        self._ocel = ocel
        self._event_col_mapping = {
            "_eventId": "ocel:eid",
            "_activity": "ocel:activity",
            "_timestampUnix": "ocel:timestamp"
        }
        self._object_col_mapping = {
            "_objId": "ocel:oid",
            "_objType": "ocel:type"
        }
        
        self.event_id_column = "ocel:eid"
        self.event_activity_column = "ocel:activity"
        self.event_timestamp_column = "ocel:timestamp"
        self.object_id_column = "ocel:oid"
        self.object_type_column = "ocel:type"
        
        self.event_activity = self.event_activity_column
        self.event_timestamp = self.event_timestamp_column
        
        # Add placeholders for other optional OCEL components
        self.qualifiers = pd.DataFrame()
        self.object_changes = pd.DataFrame()

    @cached_property
    def events(self) -> pd.DataFrame:
        """
        Returns the events DataFrame in the Pandas format expected by pm4py.
        """
        return self._ocel.events.to_pandas().rename(columns=self._event_col_mapping)

    @cached_property
    def objects(self) -> pd.DataFrame:
        """
        Returns the objects DataFrame in the Pandas format expected by pm4py.
        """
        return self._ocel.objects.to_pandas().rename(columns=self._object_col_mapping)

    @cached_property
    def relations(self) -> pd.DataFrame:
        """
        Constructs the 'relations' DataFrame, ensuring that all objects
        in the relations exist in the main objects table.
        """
        # Filter relations to ensure data consistency
        valid_oids = set(self._ocel.objects["_objId"].to_list())
        
        relations_data = []
        for event_id, event_data in self._ocel.event_cache.items():
            for obj_id in event_data["objects"]:
                # Only add the relation if the object ID is valid
                if obj_id in valid_oids:
                    relations_data.append({
                        "ocel:eid": event_id,
                        "ocel:activity": event_data["activity"],
                        "ocel:timestamp": event_data["timestamp"],
                        "ocel:oid": obj_id,
                        "ocel:type": self._ocel.obj_type_map.get(obj_id)
                    })

        return pd.DataFrame(relations_data)

    @property
    def activities(self) -> pd.Series:
        """
        Returns a Pandas Series of unique activity names.
        """
        return self.events["ocel:activity"].unique()

    @property
    def object_types(self) -> List[str]:
        """
        Returns a list of unique object types.
        """
        return self._ocel.object_types