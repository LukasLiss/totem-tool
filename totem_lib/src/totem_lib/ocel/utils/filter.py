import warnings

import polars as pl
from ..ocel import EVENTS_SCHEMA, OBJECTS_SCHEMA, OBJECT_ATTRIBUTE_SCHEMA


def schema_base_filtering(ocel):
    """
    Enforce the OCEL schemas by enforcing the specified types with non-null values for required columns,
    and removing rows with malformed data, such as events with empty object references.

    Parameters:
    -----------
    ocel : ObjectCentricEventLog
        The OCEL to be filtered.

    Returns:
    --------
    ocel : ObjectCentricEventLog
        The filtered OCEL.
    """
    # Filter events table
    if hasattr(ocel, "events") and ocel.events is not None and ocel.events.height > 0:
        # cast to schema ("_attributes" is optional)
        schema = EVENTS_SCHEMA.copy()
        if "_attributes" not in ocel.events.columns:
            schema.pop("_attributes")
        events = ocel.events.cast(schema, strict=False)

        # Critical columns may not be null/empty, lists may not be empty and need same len
        ocel.events = events.filter(
            pl.col("_eventId").is_not_null()
            & (pl.col("_eventId").str.len_chars() > 0)
            & pl.col("_activity").is_not_null()
            & (pl.col("_activity").str.len_chars() > 0)
            & pl.col("_timestampUnix").is_not_null()
            & pl.col("_objects").is_not_null()
            & (pl.col("_objects").list.len() > 0)
            & pl.col("_qualifiers").is_not_null()
            & (pl.col("_qualifiers").list.len() > 0)
            & (pl.col("_objects").list.len() == pl.col("_qualifiers").list.len())
        )

    # Filter objects table
    if (
        hasattr(ocel, "objects")
        and ocel.objects is not None
        and ocel.objects.height > 0
    ):
        # cast to schema
        objects = ocel.objects.cast(OBJECTS_SCHEMA, strict=False)

        # Critical columns may not be null/empty, lists must have same len
        ocel.objects = objects.filter(
            pl.col("_objId").is_not_null()
            & (pl.col("_objId").str.len_chars() > 0)
            & pl.col("_objType").is_not_null()
            & (pl.col("_objType").str.len_chars() > 0)
            & pl.col("_targetObjects").is_not_null()
            & pl.col("_qualifiers").is_not_null()
            & (pl.col("_targetObjects").list.len() == pl.col("_qualifiers").list.len())
        )

    # Filter object attributes table
    if (
        hasattr(ocel, "object_attributes")
        and ocel.object_attributes is not None
        and ocel.object_attributes.height > 0
    ):
        # cast to schema
        object_attributes = ocel.object_attributes.cast(
            OBJECT_ATTRIBUTE_SCHEMA, strict=False
        )

        # Critical columns may not be null/empty
        ocel.object_attributes = object_attributes.filter(
            pl.col("_objId").is_not_null()
            & (pl.col("_objId").str.len_chars() > 0)
            & pl.col("_timestampUnix").is_not_null()
        )
    
    return ocel


def propagate_filtering(ocel):
    """
    Synchronizes the OCEL tables by removing events that reference non-existing
    objects and other inconsistencies.

    Parameters:
    -----------
    ocel : ObjectCentricEventLog
        The OCEL to be filtered.

    Returns:
    --------
    ocel : ObjectCentricEventLog
        The filtered OCEL with synchronized tables.
    """

    # Identify valid objects (= present in objects table and referenced by at least one event)
    has_events = getattr(ocel, "events", None) is not None and ocel.events.height > 0
    has_objects = getattr(ocel, "objects", None) is not None and ocel.objects.height > 0

    if has_events and has_objects:
        # All referenced objects
        event_objects = (
            ocel.events.select(pl.col("_objects").explode()).drop_nulls().unique()
        )
        # All object IDs
        defined_objects = ocel.objects.select(pl.col("_objId")).unique()

        # Valid objects exist in both tables
        valid_object_ids = event_objects.join(
            defined_objects, left_on="_objects", right_on="_objId", how="inner"
        ).get_column("_objects")
    else:
        # If either table is empty/missing, there is no valid intersection
        valid_object_ids = pl.Series(name="_objects", values=[], dtype=pl.Utf8)

    # Filter events table & nested lists based on valid objects
    if has_events:
        # Add row index to keep track of original events during explode
        events_with_idx = ocel.events.with_row_index("row_idx")

        # Remove invalid objects from _objects and _qualifiers
        exploded_events = events_with_idx.select(
            "row_idx", "_objects", "_qualifiers"
        ).explode(["_objects", "_qualifiers"])
        filtered_events = exploded_events.filter(
            pl.col("_objects").is_in(valid_object_ids.implode())
        )
        rebuilt_events = filtered_events.group_by("row_idx", maintain_order=True).agg(
            pl.col("_objects"), pl.col("_qualifiers")
        )

        # Filter main table to only events that have at least one valid object reference and join back the rebuilt nested lists
        ocel.events = (
            events_with_idx.drop(["_objects", "_qualifiers"])
            .join(rebuilt_events, on="row_idx", how="inner")
            .drop("row_idx")
        )

    # Filter invalid objects from objects table and nested lists
    if has_objects:
        # Drop invalid objects
        objects = ocel.objects.filter(pl.col("_objId").is_in(valid_object_ids.implode()))

        # Clean _targetObjects of surviving objects
        objects_with_idx = objects.with_row_index("row_idx")
        exploded_targets = objects_with_idx.select(
            "row_idx", "_targetObjects", "_qualifiers"
        ).explode(["_targetObjects", "_qualifiers"])

        # We explicitly allow empty _targetObjects
        exploded_targets = exploded_targets.with_columns(
            _targetObjects=pl.when(pl.col("_targetObjects").is_in(valid_object_ids.implode()))
            .then(pl.col("_targetObjects"))
            .otherwise(None),
            _qualifiers=pl.when(pl.col("_targetObjects").is_in(valid_object_ids.implode()))
            .then(pl.col("_qualifiers"))
            .otherwise(None),
        )
        rebuilt_targets = exploded_targets.group_by("row_idx", maintain_order=True).agg(
            pl.col("_targetObjects").drop_nulls(), pl.col("_qualifiers").drop_nulls()
        )

        ocel.objects = (
            objects_with_idx.drop(["_targetObjects", "_qualifiers"])
            .join(rebuilt_targets, on="row_idx", how="inner")
            .drop("row_idx")
        )

    # Remove invalid objects from object attributes
    if (
        getattr(ocel, "object_attributes", None) is not None
        and ocel.object_attributes.height > 0
    ):
        ocel.object_attributes = ocel.object_attributes.filter(
            pl.col("_objId").is_in(valid_object_ids.implode())
        )

    # Check for duplicate event IDs and object IDs
    if getattr(ocel, "events", None) is not None and ocel.events.height > 0:
        if ocel.events.height > ocel.events.select("_eventId").n_unique():
            warnings.warn("Duplicate event IDs detected in the events table.")

    if getattr(ocel, "objects", None) is not None and ocel.objects.height > 0:
        if ocel.objects.height > ocel.objects.select("_objId").n_unique():
            warnings.warn("Duplicate object IDs detected in the objects table.")

    return ocel


def filter_dead_objects(ocel):
    """
    Remove objects that are not referenced by any event.
    This may occur when loading inconsistent OCEL files.

    Parameters:
    -----------
    ocel : ObjectCentricEventLog
        The OCEL to be filtered.

    Returns:
    --------
    ocel : ObjectCentricEventLog
        The filtered OCEL with dead objects removed.
    """
    # Get all object IDs from the objects table
    all_object_ids = set(ocel.objects["_objId"].unique().to_list())

    # Get all object IDs referenced in the events table
    referenced_object_ids = set(ocel.events["_objects"].explode().unique().to_list())

    # Determine dead objects
    dead_object_ids = all_object_ids - referenced_object_ids

    if dead_object_ids:
        # Filter out dead objects from the objects table
        ocel.objects = ocel.objects.filter(~pl.col("_objId").is_in(dead_object_ids))

    return ocel
