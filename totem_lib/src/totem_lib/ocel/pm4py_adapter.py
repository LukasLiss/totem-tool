import pandas as pd
import polars as pl
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

# Default column names for the converted PM4Py OCEL
PM4PY_EVENT_ID = DEFAULT_EVENT_ID
PM4PY_ACTIVITY = DEFAULT_EVENT_ACTIVITY
PM4PY_TIMESTAMP = DEFAULT_EVENT_TIMESTAMP
PM4PY_OBJECT_ID = DEFAULT_OBJECT_ID
PM4PY_OBJECT_TYPE = DEFAULT_OBJECT_TYPE
PM4PY_QUALIFIER = DEFAULT_QUALIFIER


def convert_ocel_polars_to_pm4py(polars_ocel: ObjectCentricEventLog) -> OCEL:
    """
    Converts a custom Polars-based ObjectCentricEventLog object to a PM4Py OCEL object.
    Does not consider object_attributes.

    Args:
        polars_ocel: The custom ObjectCentricEventLog instance using Polars.

    Returns:
        A pm4py.objects.ocel.obj.OCEL object.
    """

    # PM4Py events has event_id, event_activity, event_timestamp
    # Converts polars Unix timestamp (Int64, seconds) to a datetime object (in ns, required by PM4Py).
    pm4py_events_pl = polars_ocel.events.select(
        pl.col("_eventId").alias(PM4PY_EVENT_ID),
        pl.col("_activity").alias(PM4PY_ACTIVITY),
        pl.from_epoch(pl.col("_timestampUnix"), time_unit="s")
        .cast(pl.Datetime("ns"))
        .alias(PM4PY_TIMESTAMP),
    )
    pm4py_events = pm4py_events_pl.to_pandas()

    # PM4Py objects has object_id, object_type (+ colum for every object_attribute, not converted here)
    pm4py_objects_pl = polars_ocel.objects.select(
        pl.col("_objId").alias(PM4PY_OBJECT_ID),
        pl.col("_objType").alias(PM4PY_OBJECT_TYPE),
    )
    pm4py_objects = pm4py_objects_pl.to_pandas()

    # PM4Py relations has event_id, event_activity, event_timestamp, object_id, object_type, qualifier
    # Polars OCEL saves this in events df with a list of _objects and corresponding _qualifiers
    # -> explode '_objects' and '_qualifiers' lists in the events table
    relations_base_pl = (
        polars_ocel.events.select(
            pl.col("_eventId").alias(PM4PY_EVENT_ID),
            pl.col("_activity").alias(PM4PY_ACTIVITY),
            pl.from_epoch(pl.col("_timestampUnix"), time_unit="s")
            .cast(pl.Datetime("ns"))
            .alias(PM4PY_TIMESTAMP),
            pl.col("_objects").alias(PM4PY_OBJECT_ID),
            pl.col("_qualifiers").alias(PM4PY_QUALIFIER),
        ).explode([PM4PY_OBJECT_ID, PM4PY_QUALIFIER])
        # we explicitly do not drop nulls here (thereby retaining incorrect rows w/o objects)
    )

    # Join with the object table to inject the object type
    pm4py_relations_pl = relations_base_pl.join(
        polars_ocel.objects.select(
            pl.col("_objId").alias(PM4PY_OBJECT_ID),
            pl.col("_objType").alias(PM4PY_OBJECT_TYPE),
        ),
        on=PM4PY_OBJECT_ID,
        how="left",
    ).select(
        pl.col(PM4PY_EVENT_ID),
        pl.col(PM4PY_ACTIVITY),
        pl.col(PM4PY_TIMESTAMP),
        pl.col(PM4PY_OBJECT_ID),
        pl.col(PM4PY_OBJECT_TYPE),
        pl.col(PM4PY_QUALIFIER),
    )

    pm4py_relations = pm4py_relations_pl.to_pandas()

    # Construct o2o DataFrame (Object-to-Object Relations)
    # explode the '_targetObjects' and '_qualifiers' columns
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

    # Create PM4Py OCEL object
    pm4py_ocel = OCEL(
        events=pm4py_events,
        objects=pm4py_objects,
        relations=pm4py_relations,
        o2o=pm4py_o2o,
        globals={},
        parameters={},
        e2e=pd.DataFrame(), # e2e information is not stored in the Polars OCEL
        object_changes=pd.DataFrame(), # object attributes not handled in this conversion
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