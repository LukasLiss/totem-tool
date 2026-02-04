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
        pl.from_epoch(pl.col("_timestampUnix"), time_unit="s").alias(PM4PY_TIMESTAMP),
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
        .drop_nulls(subset=[PM4PY_OBJECT_ID])
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
        .drop_nulls(subset=[PM4PY_OBJECT_ID + "_2"])
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


def convert_pm4py_to_ocel_polars(pm4py_ocel: OCEL) -> ObjectCentricEventLog:
    """
    Converts a PM4Py OCEL object to a custom Polars-based ObjectCentricEventLog object.

    Args:
        pm4py_ocel: The pm4py.objects.ocel.obj.OCEL object.

    Returns:
        ObjectCentricEventLog: A custom ObjectCentricEventLog instance using Polars.
    """

    # 1. Reconstruct Events DataFrame
    # Join events with relations to get objects per event
    
    # Ensure we work with pandas DataFrames
    events_df = pm4py_ocel.events.copy()
    relations_df = pm4py_ocel.relations.copy()
    
    # Merge events with relations. We use a left merge to keep all events.
    # Relationships might be multiple per event, so this explodes the events table initially.
    # merging on event ID
    merged_events = events_df.merge(
        relations_df, 
        on=pm4py_ocel.event_id_column, 
        how="left", 
        suffixes=("", "_rel")
    )

    # We need to aggregate multiple objects and qualifiers into lists for each event.
    # Group by all event attributes
    event_group_cols = [pm4py_ocel.event_id_column, pm4py_ocel.event_activity, pm4py_ocel.event_timestamp]
    
    # Handling potential extra columns in events if necessary? For now stick to standard 3.
    
    # Prepare aggregation dictionary
    agg_dict = {
        pm4py_ocel.object_id_column: lambda x: list(x.dropna()),
        pm4py_ocel.qualifier: lambda x: list(x.dropna())
    }

    events_aggregated = merged_events.groupby(event_group_cols).agg(agg_dict).reset_index()

    # Convert to Polars
    events_pl = pl.from_pandas(events_aggregated)
    
    # Rename and format columns
    events_pl = events_pl.select(
        pl.col(pm4py_ocel.event_id_column).alias("_eventId"),
        pl.col(pm4py_ocel.event_activity).alias("_activity"),
        pl.col(pm4py_ocel.event_timestamp).cast(pl.Datetime).dt.epoch(time_unit="s").alias("_timestampUnix"),
        pl.col(pm4py_ocel.object_id_column).alias("_objects"),
        pl.col(pm4py_ocel.qualifier).alias("_qualifiers")
    )


    # 2. Reconstruct Objects DataFrame
    objects_df = pm4py_ocel.objects.copy()
    o2o_df = pm4py_ocel.o2o.copy()

    # Merge objects with o2o to get target objects and qualifiers
    # o2o table has: object_id, object_id_2, qualifier
    merged_objects = objects_df.merge(
        o2o_df,
        left_on=pm4py_ocel.object_id_column,
        right_on=pm4py_ocel.object_id_column,
        how="left",
        suffixes=("", "_rel")
    )
    
    # Group columns
    obj_group_cols = [pm4py_ocel.object_id_column, pm4py_ocel.object_type_column]
    
    # Prepare aggregation dictionary for objects
    # Target object column in o2o is typically object_id + "_2"
    target_obj_col = pm4py_ocel.object_id_column + "_2"
    
    agg_dict_obj = {
        target_obj_col: lambda x: list(x.dropna()),
        pm4py_ocel.qualifier: lambda x: list(x.dropna())
    }
    
    objects_aggregated = merged_objects.groupby(obj_group_cols).agg(agg_dict_obj).reset_index()

    # Convert to Polars
    objects_pl = pl.from_pandas(objects_aggregated)

    # Rename and format columns
    objects_pl = objects_pl.select(
        pl.col(pm4py_ocel.object_id_column).alias("_objId"),
        pl.col(pm4py_ocel.object_type_column).alias("_objType"),
        pl.col(target_obj_col).alias("_targetObjects"),
        pl.col(pm4py_ocel.qualifier).alias("_qualifiers")
    )

    return ObjectCentricEventLog(events=events_pl, objects=objects_pl)
