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
