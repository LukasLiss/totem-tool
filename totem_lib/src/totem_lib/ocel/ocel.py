import polars as pl
import networkx as nx
import json
from functools import cached_property
from typing import List, Tuple, Dict
from collections import defaultdict

EVENTS_SCHEMA = {
    "_eventId": pl.Utf8,
    "_activity": pl.Utf8,
    "_timestampUnix": pl.Int64,
    "_objects": pl.List(pl.Utf8),
    "_qualifiers": pl.List(pl.Utf8),
    "_attributes": pl.Utf8,
}

OBJECTS_SCHEMA = {
    "_objId": pl.Utf8,
    "_objType": pl.Utf8,
    "_targetObjects": pl.List(pl.Utf8),
    "_qualifiers": pl.List(pl.Utf8),
}

OBJECT_ATTRIBUTE_SCHEMA = {
    "_objId": pl.Utf8,
    "_timestampUnix": pl.Int64,
    "_jsonObjAttributes": pl.Utf8,
}


class ObjectCentricEventLog:
    """
    Represents an Object-Centric Event Log (OCEL).

    This class stores events and objects in Polars DataFrames and provides
    methods for adding data, accessing event and object attributes, and
    managing the object-to-object graph.
    """

    def __init__(
        self,
        events: pl.DataFrame,
        objects: pl.DataFrame,
        object_attributes: pl.DataFrame | None = None,
    ):
        """
        Initializes the ObjectCentricEventLog with events and objects DataFrames.

        Args:
            events (pl.DataFrame): A DataFrame containing event data.
            objects (pl.DataFrame): A DataFrame containing object data.
            object_attributes (pl.DataFrame | None): Optional DataFrame containing
                object attribute changes over time. If None, an empty DataFrame
                with the OBJECT_ATTRIBUTE_SCHEMA is created.
        """
        self.events = events
        self.objects = objects

        # Initialize object_attributes DataFrame
        if object_attributes is None:
            self.object_attributes = pl.DataFrame(schema=OBJECT_ATTRIBUTE_SCHEMA)
        else:
            self.object_attributes = object_attributes

    def __repr__(self) -> str:
        """
        Returns a string representation of the ObjectCentricEventLog.

        Displays summary statistics and previews of the events, objects,
        and object_attributes DataFrames.

        Returns:
            str: A formatted string representation of the log.
        """
        lines = []
        lines.append("ObjectCentricEventLog")
        lines.append("=" * 80)
        lines.append(f"Number of events: {self.events.height}")
        lines.append(f"Number of objects: {self.objects.height}")
        lines.append(
            f"Number of object attribute records: {self.object_attributes.height}"
        )
        lines.append("")

        # Helper function to get preview of a dataframe
        def get_df_preview(df: pl.DataFrame, name: str) -> str:
            result = [f"{name}:"]
            if df.height == 0:
                result.append("  (empty)")
            elif df.height <= 5:
                result.append(str(df))
            else:
                # Show first 3 rows
                result.append(str(df.head(3)))
                result.append("  ...")
                # Show last 2 rows
                result.append(str(df.tail(2)))
            return "\n".join(result)

        lines.append(get_df_preview(self.events, "Events Preview (head and tail)"))
        lines.append("")
        lines.append(get_df_preview(self.objects, "Objects Preview (head and tail)"))
        lines.append("")
        lines.append(
            get_df_preview(
                self.object_attributes, "Object Attributes Preview (head and tail)"
            )
        )

        return "\n".join(lines)

    @cached_property
    def o2o_graph_edges(self) -> List[Tuple[str, str]]:
        """
        Returns the object-to-object graph edges.
        Each edge is a tuple (source_object_id, target_object_id).
        """
        objects_ungrouped_df = (
            self.objects.explode(["_targetObjects", "_qualifiers"])
            .select(
                pl.col("_objId").alias("source"),
                pl.col("_targetObjects").alias("target"),
            )
            .drop_nulls()
        )
        return objects_ungrouped_df.rows()

    @cached_property
    def o2o_graph_edges_with_qualifiers(self) -> List[Tuple[str, str, str]]:
        """
        Returns the object-to-object graph edges with their qualifiers.
        Each edge is a tuple (source_object_id, target_object_id, qualifier).
        The qualifier indicates the type of relationship (e.g., "has", "belongs-to").
        """
        objects_ungrouped_df = (
            self.objects.explode(["_targetObjects", "_qualifiers"])
            .select(
                pl.col("_objId").alias("source"),
                pl.col("_targetObjects").alias("target"),
                pl.col("_qualifiers").alias("qualifier"),
            )
            .drop_nulls()
        )
        return objects_ungrouped_df.rows()

    @cached_property
    def event_cache(self) -> Dict[str, dict]:
        """
        Returns a cache of events attributes.
        The keys are event IDs and the values are dictionaries of attributes.
        """
        ev_cache = {}

        events_iter = self.events.select(
            ["_eventId", "_activity", "_timestampUnix", "_objects"]
        ).iter_rows(named=True)

        for event in events_iter:
            event_id = event["_eventId"]
            objects = event["_objects"] or []

            objects_by_type = defaultdict(list)
            for obj_id in objects:
                obj_type = self.obj_type_map.get(obj_id)
                if obj_type:
                    objects_by_type[obj_type].append(obj_id)

            ev_cache[event_id] = {
                "activity": event["_activity"],
                "timestamp": event["_timestampUnix"],
                "objects": objects,
                "objects_by_type": dict(objects_by_type),
            }
        return ev_cache

    @cached_property
    def obj_type_map(self) -> dict[str, str]:
        """
        Returns a dictionary mapping object IDs to their types.
        The map is built and cached on first access.
        """
        return dict(self.objects.select(["_objId", "_objType"]).iter_rows())

    @cached_property
    def object_types(self) -> list[str]:
        """
        Returns a (cached) list of all unique object types present in the log.
        """
        return self.objects["_objType"].unique().to_list()

    @property
    def process_executions(self) -> list[list[str]]:
        """
        Returns a list of process executions.
        For compatibility with the totem miner, it currently returns a single list containing all event IDs.
        """
        # for compatibility with the original interface
        return [self.events["_eventId"].to_list()]

    def get_value(self, event_id: str, attribute: str):
        """
        Optimized interface for the totem miner to retrieve event attributes.
        Uses cached data for fast lookups.

        Args:
            event_id (str): The ID of the event.
            attribute (str): The name of the attribute to retrieve (e.g., "event_timestamp",
                             "event_activity", "event_objects", or an object type).

        Returns:
            Union[int, str, List[str], None]: The value of the attribute, or an empty list
                                              if the attribute is an object type with no
                                              matching objects, or None if the event or
                                              attribute is not found.
        """

        event_data = self.event_cache.get(event_id)
        if event_data is None:
            return None

        if attribute == "event_timestamp":
            # return datetime.utcfromtimestamp(ts_unix).strftime(DATEFORMAT)
            return event_data[
                "timestamp"
            ]  # just use unix since temporal order is preserved
        elif attribute == "event_activity":
            return event_data["activity"]
        elif attribute == "event_objects":
            return event_data["objects"]
        else:
            # otherwise attribute == some object_type → filter
            return event_data["objects_by_type"].get(attribute, [])

    def get_event(self, event_id: str) -> dict | None:
        """
        Returns the event object (as a dictionary) for the given event ID.

        Args:
            event_id (str): The ID of the event.

        Returns:
            dict | None: A dictionary representing the event, or None if not found.
        """
        return self.event_cache.get(event_id)

    def get_event_timestamp(self, event_id: str) -> int | None:
        """
        Returns the timestamp for the given event ID.

        Args:
            event_id (str): The ID of the event.

        Returns:
            int | None: The Unix timestamp of the event, or None if the event is not found.
        """
        event = self.event_cache.get(event_id)
        return event["timestamp"] if event else None

    def get_event_activity(self, event_id: str) -> str | None:
        """
        Returns the activity for the given event ID.

        Args:
            event_id (str): The ID of the event.

        Returns:
            str | None: The activity name of the event, or None if the event is not found.
        """
        event = self.event_cache.get(event_id)
        return event["activity"] if event else None

    def get_event_objectIDs(self, event_id: str) -> List[str]:
        """
        Returns the list of object IDs for the given event ID.

        Args:
            event_id (str): The ID of the event.

        Returns:
            List[str]: A list of object IDs associated with the event, or an empty list if
                       the event is not found.
        """
        event = self.event_cache.get(event_id)
        return event["objects"] if event else []

    def get_event_objects_by_type(self, event_id: str, obj_type: str) -> List[str]:
        """
        Returns the list of object IDs of the specified type for the given event ID.

        Args:
            event_id (str): The ID of the event.
            obj_type (str): The type of objects to filter by.

        Returns:
            List[str]: A list of object IDs of the specified type, or an empty list if
                       the event or object type is not found.
        """
        event = self.event_cache.get(event_id)
        if event:
            return event["objects_by_type"].get(obj_type, [])
        return []

    def get_event_attributes(self, event_id: str) -> List[str]:
        """
        Returns the attribute keys for the given event ID.

        Args:
            event_id (str): The ID of the event.

        Returns:
            List[str]: A list of attribute keys for the event. Returns an empty list
                       if the event is not found or has no attributes.
        """
        # Get the event row
        event_row = self.events.filter(pl.col("_eventId") == event_id).select(
            "_attributes"
        )

        if event_row.height == 0:
            return []

        attributes_json = event_row.item(0, 0)

        if attributes_json is None or attributes_json == "":
            return []

        try:
            attributes_dict = json.loads(attributes_json)
            return list(attributes_dict.keys())
        except json.JSONDecodeError:
            return []

    def get_event_attribute_value(self, event_id: str, attribute_key: str) -> str:
        """
        Returns the value of a specific attribute for the given event ID.

        Args:
            event_id (str): The ID of the event.
            attribute_key (str): The key of the attribute to retrieve.

        Returns:
            str: The value of the attribute.

        Raises:
            ValueError: If the event is not found.
            KeyError: If the attribute key is not found in the event's attributes.
        """
        # Get the event row
        event_row = self.events.filter(pl.col("_eventId") == event_id).select(
            "_attributes"
        )

        if event_row.height == 0:
            raise ValueError(f"Event with ID '{event_id}' not found")

        attributes_json = event_row.item(0, 0)

        if attributes_json is None or attributes_json == "":
            raise KeyError(
                f"Attribute key '{attribute_key}' not found for event '{event_id}'"
            )

        try:
            attributes_dict = json.loads(attributes_json)
        except json.JSONDecodeError:
            raise ValueError(f"Invalid JSON in attributes for event '{event_id}'")

        if attribute_key not in attributes_dict:
            raise KeyError(
                f"Attribute key '{attribute_key}' not found for event '{event_id}'"
            )

        return attributes_dict[attribute_key]

    def get_object_attributes(self, object_id: str) -> List[str]:
        """
        Returns all attribute keys that the given object has ever had.

        Args:
            object_id (str): The ID of the object.

        Returns:
            List[str]: A list of unique attribute keys that have been set for this object
                       across all timestamps. Returns an empty list if the object has no
                       attribute records.
        """
        # Get all rows for this object
        object_rows = self.object_attributes.filter(
            pl.col("_objId") == object_id
        ).select("_jsonObjAttributes")

        if object_rows.height == 0:
            return []

        # Collect all unique keys across all timestamps
        all_keys = set()
        for row in object_rows.iter_rows():
            attributes_json = row[0]
            if attributes_json is not None and attributes_json != "":
                try:
                    attributes_dict = json.loads(attributes_json)
                    all_keys.update(attributes_dict.keys())
                except json.JSONDecodeError:
                    continue

        return sorted(list(all_keys))

    def get_object_attribute_value(
        self, object_id: str, attribute_key: str, timestamp: int | None = None
    ) -> str:
        """
        Returns the value of a specific attribute for the given object at a specific time.

        This method finds the most recent value of the attribute that was set at or before
        the specified timestamp. If no timestamp is provided, it returns the latest value.

        Args:
            object_id (str): The ID of the object.
            attribute_key (str): The key of the attribute to retrieve.
            timestamp (int | None): Unix timestamp. If None, returns the latest value.
                                   If specified, returns the value at or before this timestamp.

        Returns:
            str: The value of the attribute at the specified time.

        Raises:
            ValueError: If the object has no attribute records.
            KeyError: If the attribute key has never been set for this object, or if it
                     hasn't been set by the specified timestamp.
        """
        # Get all rows for this object, sorted by timestamp descending
        if timestamp is None:
            # Get all rows, sorted by timestamp descending
            object_rows = self.object_attributes.filter(
                pl.col("_objId") == object_id
            ).sort("_timestampUnix", descending=True)
        else:
            # Get rows at or before the timestamp, sorted by timestamp descending
            object_rows = self.object_attributes.filter(
                (pl.col("_objId") == object_id)
                & (pl.col("_timestampUnix") <= timestamp)
            ).sort("_timestampUnix", descending=True)

        if object_rows.height == 0:
            raise ValueError(
                f"No attribute records found for object '{object_id}'"
                + (
                    f" at or before timestamp {timestamp}"
                    if timestamp is not None
                    else ""
                )
            )

        # Iterate through rows from most recent to oldest
        for row in object_rows.iter_rows(named=True):
            attributes_json = row["_jsonObjAttributes"]
            if attributes_json is not None and attributes_json != "":
                try:
                    attributes_dict = json.loads(attributes_json)
                    if attribute_key in attributes_dict:
                        return attributes_dict[attribute_key]
                except json.JSONDecodeError:
                    continue

        # If we get here, the attribute key was never found
        raise KeyError(
            f"Attribute key '{attribute_key}' not found for object '{object_id}'"
            + (f" at or before timestamp {timestamp}" if timestamp is not None else "")
        )

    ### NEW X sonntag ###

    from collections import defaultdict
    import networkx as nx
    from functools import cached_property

    @cached_property
    def eog(self) -> nx.DiGraph:
        """
        Event–Object Graph (EOG).
        Nodes: event ids with attributes:
        - 'label'     -> activity name
        - 'timestamp' -> _timestampUnix
        Edges: for each object, connect its consecutive events (by time).
        - 'type'    -> pipe-joined inducing object type(s)
        - 'objects' -> sorted list of inducing object IDs
        """
        G = nx.DiGraph()

        # 1) Add nodes
        for row in self.events.select(
            ["_eventId", "_activity", "_timestampUnix"]
        ).iter_rows(named=True):
            G.add_node(
                row["_eventId"],
                label=row["_activity"],
                timestamp=int(row["_timestampUnix"])
                if row["_timestampUnix"] is not None
                else 0,
            )

        # 2) Prepare per-object event sequences
        obj_to_seq = defaultdict(list)  # oid -> [(ts, eid), ...]
        for row in self.events.select(
            ["_eventId", "_timestampUnix", "_objects"]
        ).iter_rows(named=True):
            eid = row["_eventId"]
            ts = int(row["_timestampUnix"]) if row["_timestampUnix"] is not None else 0
            for oid in row["_objects"] or []:
                obj_to_seq[oid].append((ts, eid))

        # 3) Collect edge labels (may aggregate across objects/types)
        edge_types = defaultdict(set)  # (u,v) -> {otype, ...}
        edge_objs = defaultdict(set)  # (u,v) -> {oid, ...}

        for oid, seq in obj_to_seq.items():
            if len(seq) < 2:
                continue
            seq.sort(key=lambda t: (t[0], t[1]))  # stable by (timestamp, event_id)
            otype = self.obj_type_map.get(oid, "UNKNOWN")
            for (_, u), (_, v) in zip(seq, seq[1:]):
                edge_types[(u, v)].add(otype)
                edge_objs[(u, v)].add(oid)

        # 4) Materialize edges with canonical attributes
        for (u, v), types in edge_types.items():
            G.add_edge(
                u,
                v,
                type="|".join(sorted(types)),
                objects=sorted(edge_objs[(u, v)]),
            )

        return G

    ### TODO check pls @Toan
    def filter_by_object_type(self, object_type: str) -> "ObjectCentricEventLog":
        """
        Filters the event log to include only a single object type and its related events.

        This method performs two main steps:
        1. Filters the objects DataFrame to keep only those matching the specified object_type.
        2. Filters the events DataFrame to keep only the events that are associated with
        at least one of the objects from the filtered set.

        Args:
            object_type (str): The object type to keep in the log (e.g., "container").

        Returns:
            ObjectCentricEventLog: A new, filtered instance of the ObjectCentricEventLog.
        """
        # 1. Filter the objects DataFrame to get only the relevant objects
        filtered_objects = self.objects.filter(pl.col("_objType") == object_type)

        # 2. Get the set of IDs for these relevant objects
        relevant_object_ids = filtered_objects.get_column("_objId")

        # 3. Filter the events DataFrame
        # Keep an event if its list of objects has a non-empty intersection
        # with our set of relevant object IDs.
        filtered_events = self.events.filter(
            pl.col("_objects")
            .list.eval(pl.element().is_in(relevant_object_ids))
            .list.any()
        )

        # 4. Return a new event log instance with the filtered DataFrames
        return ObjectCentricEventLog(events=filtered_events, objects=filtered_objects)

    def get_object_ids_by_type(self, object_type: str) -> List[str]:
        """
        Returns a list of object IDs for a given object type.
        """
        return (
            self.objects.filter(pl.col("_objType") == object_type)
            .get_column("_objId")
            .to_list()
        )
