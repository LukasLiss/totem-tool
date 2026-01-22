import pandas as pd
import polars as pl
from functools import cached_property
from typing import Dict, List, Tuple
from datetime import datetime
from pm4py.objects.ocel.obj import OCEL
from pm4py.objects.ocel.constants import (
    DEFAULT_EVENT_ID,
    DEFAULT_OBJECT_ID,
    DEFAULT_OBJECT_TYPE,
    DEFAULT_EVENT_ACTIVITY,
    DEFAULT_EVENT_TIMESTAMP,
    DEFAULT_QUALIFIER,
)
from . import ObjectCentricEventLog

# TODO: add schemas
# (EVENTS_SCHEMA, OBJECTS_SCHEMA, ObjectCentricEventLog)

# Constants based on standard PM4Py OCEL naming conventions
PM4PY_EVENT_ID = DEFAULT_EVENT_ID
PM4PY_ACTIVITY = DEFAULT_EVENT_ACTIVITY
PM4PY_TIMESTAMP = DEFAULT_EVENT_TIMESTAMP
PM4PY_OBJECT_ID = DEFAULT_OBJECT_ID
PM4PY_OBJECT_TYPE = DEFAULT_OBJECT_TYPE
PM4PY_QUALIFIER = DEFAULT_QUALIFIER


class PolarsOCELAdapter:
    """
    An adapter class to make the Polars-based ObjectCentricEventLog compatible
    with the pm4py library, which expects a Pandas-based interface.
    This may be passed to pm4py functions that require an OCEL input.
    """

    # TODO: proofread and test this class
    def __init__(self, ocel: "ObjectCentricEventLog"):
        self._ocel = ocel
        self._event_col_mapping = {
            "_eventId": "ocel:eid",
            "_activity": "ocel:activity",
            "_timestampUnix": "ocel:timestamp",
        }
        self._object_col_mapping = {"_objId": "ocel:oid", "_objType": "ocel:type"}

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
        # TODO: replace slow for-loop with vectorized operation
        for event_id, event_data in self._ocel.event_cache.items():
            for obj_id in event_data["objects"]:
                # Only add the relation if the object ID is valid
                if obj_id in valid_oids:
                    relations_data.append(
                        {
                            "ocel:eid": event_id,
                            "ocel:activity": event_data["activity"],
                            "ocel:timestamp": event_data["timestamp"],
                            "ocel:oid": obj_id,
                            "ocel:type": self._ocel.obj_type_map.get(obj_id),
                        }
                    )

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


def convert_ocel_polars_to_pm4py(polars_ocel: ObjectCentricEventLog) -> OCEL:
    """
    Converts a custom Polars-based ObjectCentricEventLog object to a PM4Py OCEL object.

    Args:
        polars_ocel: The custom ObjectCentricEventLog instance using Polars.

    Returns:
        A pm4py.objects.ocel.obj.OCEL object.
    """

    # 1. Prepare Events DataFrame (pm4py.events)
    # Converts Unix timestamp (Int64, assumed milliseconds) to a proper datetime object.
    pm4py_events_pl = polars_ocel.events.select(
        pl.col("_eventId").alias(PM4PY_EVENT_ID),
        pl.col("_activity").alias(PM4PY_ACTIVITY),
        pl.from_epoch(pl.col("_timestampUnix"), time_unit="ms").alias(PM4PY_TIMESTAMP),
    )
    pm4py_events = pm4py_events_pl.to_pandas()

    # 2. Prepare Objects DataFrame (pm4py.objects)
    pm4py_objects_pl = polars_ocel.objects.select(
        pl.col("_objId").alias(PM4PY_OBJECT_ID),
        pl.col("_objType").alias(PM4PY_OBJECT_TYPE),
    )
    pm4py_objects = pm4py_objects_pl.to_pandas()

    # 3. Construct Relations DataFrame (pm4py.relations - Event-Object Links)
    # This involves exploding the nested '_objects' and '_qualifiers' lists in the events table
    relations_base_pl = (
        polars_ocel.events.select(
            pl.col("_eventId").alias(PM4PY_EVENT_ID),
            pl.col("_activity").alias(PM4PY_ACTIVITY),
            pl.col("_timestampUnix"),
            pl.col("_objects").alias(PM4PY_OBJECT_ID),
            pl.col("_qualifiers").alias(PM4PY_QUALIFIER),
        )
        .explode([PM4PY_OBJECT_ID, PM4PY_QUALIFIER])
        .drop_nulls()
    )

    # Join with the object table to inject the object type
    pm4py_relations_pl = relations_base_pl.join(
        polars_ocel.objects.select(
            pl.col("_objId").alias(PM4PY_OBJECT_ID),
            pl.col("_objType").alias(PM4PY_OBJECT_TYPE),
        ),
        on=PM4PY_OBJECT_ID,
        how="left",  # TODO: why is vh130 in event_object and object_object but not in objects?
    ).select(
        pl.col(PM4PY_EVENT_ID),
        pl.col(PM4PY_ACTIVITY),
        pl.from_epoch(pl.col("_timestampUnix"), time_unit="ms").alias(PM4PY_TIMESTAMP),
        pl.col(PM4PY_OBJECT_ID),
        pl.col(PM4PY_OBJECT_TYPE),
        pl.col(PM4PY_QUALIFIER),
    )

    pm4py_relations = pm4py_relations_pl.to_pandas()

    # 4. Construct O2O DataFrame (pm4py.o2o - Object-to-Object Relations)
    # This table is generated by exploding the '_targetObjects' and '_qualifiers' columns in the objects table
    pm4py_o2o_pl = (
        polars_ocel.objects.select(
            pl.col("_objId").alias(PM4PY_OBJECT_ID),
            pl.col("_targetObjects").alias(PM4PY_OBJECT_ID + "_2"),
            pl.col("_qualifiers").alias(PM4PY_QUALIFIER),
        )
        .explode([PM4PY_OBJECT_ID + "_2", PM4PY_QUALIFIER])
        .drop_nulls()
    )

    pm4py_o2o = pm4py_o2o_pl.to_pandas()

    # 5. Create PM4Py OCEL object
    # Use default parameter mapping, which aligns with the column renaming performed above
    pm4py_ocel = OCEL(
        events=pm4py_events,
        objects=pm4py_objects,
        relations=pm4py_relations,
        o2o=pm4py_o2o,
        globals={},
        parameters={},  # Parameters are usually only needed if you deviate from defaults
        e2e=pd.DataFrame(),
        object_changes=pd.DataFrame(),
    )

    return pm4py_ocel
