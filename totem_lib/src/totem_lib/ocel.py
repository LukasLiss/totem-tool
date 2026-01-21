import polars as pl
from typing import List, Tuple, Dict
import sqlite3
import json
import xml.etree.ElementTree as ET
import os
from collections import defaultdict
from functools import cached_property
import networkx as nx

EVENTS_SCHEMA = {
    "_eventId": pl.Utf8,
    "_activity": pl.Utf8,
    "_timestampUnix": pl.Int64,
    "_objects": pl.List(pl.Utf8),
    "_qualifiers": pl.List(pl.Utf8),
}

OBJECTS_SCHEMA = {
    "_objId": pl.Utf8,
    "_objType": pl.Utf8,
    "_targetObjects": pl.List(pl.Utf8),
    "_qualifiers": pl.List(pl.Utf8),
}


class ObjectCentricEventLog:
    """
    Represents an Object-Centric Event Log (OCEL).

    This class stores events and objects in Polars DataFrames and provides
    methods for adding data, accessing event and object attributes, and
    managing the object-to-object graph.
    """

    def __init__(self, events: pl.DataFrame, objects: pl.DataFrame):
        """
        Initializes the ObjectCentricEventLog with events and objects DataFrames.

        Args:
            events (pl.DataFrame): A DataFrame containing event data.
            objects (pl.DataFrame): A DataFrame containing object data.
        """
        self.events = events
        self.objects = objects

        # Store additional attributes
        self.event_attributes: Dict[str, pl.DataFrame] = {}  # TODO: implement importer
        self.object_attributes: Dict[
            str, Dict[str, List[Tuple[int, str]]]
        ] = {}  # TODO: implement importer

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
    def filter_by_object_type(self, object_type: str) -> 'ObjectCentricEventLog':
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
            pl.col("_objects").list.eval(pl.element().is_in(relevant_object_ids)).list.any()
        )

        # 4. Return a new event log instance with the filtered DataFrames
        return ObjectCentricEventLog(events=filtered_events, objects=filtered_objects)
    
    def get_object_ids_by_type(self, object_type: str) -> List[str]:
        """
        Returns a list of object IDs for a given object type.
        """
        return (
            self.objects
            .filter(pl.col("_objType") == object_type)
            .get_column("_objId")
            .to_list()
        )

class OcelFileImporter:
    """
    Class to import OCEL 2.0 files into the ObjectCentricEventLog structure.
    Supports SQLite, JSON, and XML formats.
    Docs: www.ocel-standard.org
    (Deprecated, use import_ocel function instead)
    """

    def __init__(self, file_path: str, file_format: str = None):
        """
        Initializes the OcelFileImporter.

        Args:
            file_path (str): The path to the OCEL file.
            file_format (str, optional): The format of the OCEL file ("sqlite", "json", or "xml").
                                         Defaults to "sqlite".
        """
        self.file_path = file_path
        self.file_format = file_format
        self.event_log = ObjectCentricEventLog()

    def import_file(self) -> ObjectCentricEventLog:
        """
        Imports the OCEL file based on its format and returns an ObjectCentricEventLog.
        (Deprecated, use import_ocel function instead)

        Returns:
            ObjectCentricEventLog: The imported object-centric event log.

        Raises:
            ValueError: If the specified file format is not supported.
        """
        print(
            "Warning: OcelFileImporter is deprecated, use import_ocel function instead."
        )
        if self.file_format is None:
            path = self.file_path
            ending = os.path.basename(path).split(".")[-1]
            if ending == "sqlite":
                return self._import_sqlite()
            elif ending == "json":
                return self._import_json()
            elif ending == "xml":
                return self._import_xml()
        elif self.file_format == "sqlite":
            return self._import_sqlite()
        elif self.file_format == "json":
            return self._import_json()
        elif self.file_format == "xml":
            return self._import_xml()
        else:
            raise ValueError(
                f"Unsupported file format: {self.file_format}. Please use 'sqlite', 'json', or 'xml'."
            )

    def _import_sqlite(self) -> ObjectCentricEventLog:
        """
        Imports events and objects from an SQLite OCEL file.

        Returns:
            ObjectCentricEventLog: The populated object-centric event log.
        """
        self.event_log.events = load_events_from_sqlite(self.file_path)
        self.event_log.objects = load_objects_from_sqlite(self.file_path)
        return self.event_log

    def _import_json(self) -> ObjectCentricEventLog:
        """
        Imports events and objects from a JSON OCEL file.

        Returns:
            ObjectCentricEventLog: The populated object-centric event log.
        """
        self.event_log.events = load_events_from_json(self.file_path)
        self.event_log.objects = load_objects_from_json(self.file_path)
        return self.event_log

    def _import_xml(self) -> ObjectCentricEventLog:
        """
        Imports events and objects from an XML OCEL file.

        Returns:
            ObjectCentricEventLog: The populated object-centric event log.
        """
        self.event_log.events = load_events_from_xml(self.file_path)
        self.event_log.objects = load_objects_from_xml(self.file_path)
        return self.event_log


def import_ocel(file_path: str, file_format: str = None) -> ObjectCentricEventLog:
    """
    Imports an OCEL 2.0 file and returns an ObjectCentricEventLog.

    Args:
        file_path (str): The path to the OCEL file.
        file_format (str, optional): The format of the OCEL file. Must be one of "sqlite", "json", or "xml".

    Returns:
        ObjectCentricEventLog: The imported object-centric event log.
    """
    if file_format is None:
        extension_map = {".sqlite": "sqlite", ".json": "json", ".xml": "xml"}
        _, ext = os.path.splitext(file_path)
        file_format = extension_map.get(ext.lower())
        if file_format is None:
            raise ValueError(
                f"Could not infer file format from extension '{ext}'."
                f"Please specify the file_format parameter, or use one of {list(extension_map.values())}."
            )

    loaders = {
        "sqlite": (load_events_from_sqlite, load_objects_from_sqlite),
        "json": (load_events_from_json, load_objects_from_json),
        "xml": (load_events_from_xml, load_objects_from_xml),
    }

    if file_format not in loaders:
        raise ValueError(f"Unsupported file format: {file_format}")

    events_loader, objects_loader = loaders[file_format]
    events_df = events_loader(file_path)
    objects_df = objects_loader(file_path)

    return ObjectCentricEventLog(events=events_df, objects=objects_df)


def load_events_from_sqlite(file_path: str) -> pl.DataFrame:
    """
    Loads event data from an SQLite OCEL file into a Polars DataFrame.

    Args:
        file_path (str): The path to the SQLite OCEL file.

    Returns:
        pl.DataFrame: A DataFrame containing event data with columns
                      _eventId, _activity, _timestampUnix, _objects, and _qualifiers.
    """
    con = sqlite3.connect(file_path)
    cursor = con.cursor()

    # get list of activity names
    cursor.execute("SELECT ocel_type_map as activity FROM event_map_type")
    activities = [row[0] for row in cursor]
    # print(activities)

    # build the union timestamp table query for all activities
    timestamp_union_query = " UNION ".join(
        [f"SELECT ocel_id, ocel_time FROM event_{activity}" for activity in activities]
    )

    # event to object relation query (with LEFT JOIN to include all events)
    event_object_query = """
        SELECT 
            ocel_id as _eventId, 
            e.ocel_type as _activity,
            eo.ocel_object_id as _object,
            eo.ocel_qualifier as _qualifier
        FROM 
            (((event e JOIN event_map_type emt ON e.ocel_type = emt.ocel_type) a LEFT JOIN event_object eo ON a.ocel_id = eo.ocel_event_id))
    """

    # join the event object relation with the timestamp union query
    query = f"""
        SELECT 
            e._eventId, 
            e._activity,
            e._object,
            e._qualifier,
            t.ocel_time as _timestamp_str
        FROM 
            ({event_object_query}) e
        LEFT JOIN 
            ({timestamp_union_query}) t ON e._eventId = t.ocel_id
    """

    df = pl.read_database(query=query, connection=con)
    con.close()

    # Group by event ID and aggregate objects and qualifiers into lists
    df = df.group_by("_eventId").agg(
        [
            pl.col("_object").alias("_objects"),
            pl.col("_qualifier").alias("_qualifiers"),
            pl.col("_activity").first(),
            pl.col("_timestamp_str").first(),
        ]
    )

    # transform [null] to empty list []
    df = df.with_columns(
        _objects=pl.col("_objects").list.drop_nulls(),
        _qualifiers=pl.col("_qualifiers").list.drop_nulls(),
    )

    # Convert the timestamp string to a datetime object and then to epoch seconds
    df = df.with_columns(
        pl.col("_timestamp_str").str.to_datetime().alias("_timestamp_datetime")
    )
    df = df.with_columns(
        pl.col("_timestamp_datetime").dt.epoch(time_unit="s").alias("_timestampUnix"),
    )

    df = df.select(
        ["_eventId", "_activity", "_timestampUnix", "_objects", "_qualifiers"]
    ).sort("_eventId")

    return df


def load_objects_from_sqlite(file_path: str) -> pl.DataFrame:
    """
    Loads object data from an SQLite OCEL file into a Polars DataFrame.

    Args:
        file_path (str): The path to the SQLite OCEL file.

    Returns:
        pl.DataFrame: A DataFrame containing object data with columns
                      _objId, _objType, _targetObjects, and _qualifiers.
    """
    con = sqlite3.connect(file_path)

    df_objs = pl.read_database(
        query="""
            SELECT
              o.ocel_id   AS _objId,
              o.ocel_type AS _objType
            FROM object o
            JOIN object_map_type omt
              ON o.ocel_type = omt.ocel_type
        """,
        connection=con,
    )

    df_rel = pl.read_database(
        query="""
            SELECT
              ocel_source_id AS _objId,
              ocel_target_id,
              ocel_qualifier
            FROM object_object
        """,
        connection=con,
    )
    con.close()

    df_targets = (
        df_rel.group_by("_objId")
        .agg(
            [
                pl.col("ocel_target_id").alias("_targetObjects"),
                pl.col("ocel_qualifier").alias("_qualifiers"),
            ]
        )
        .with_columns(
            [
                pl.col("_targetObjects").list.drop_nulls().alias("_targetObjects"),
                pl.col("_qualifiers").list.drop_nulls().alias("_qualifiers"),
            ]
        )
    )

    df = df_objs.join(df_targets, on="_objId", how="left").with_columns(
        [
            pl.when(pl.col("_targetObjects").is_null())
            .then(pl.lit([]).cast(pl.List(pl.Utf8)))
            .otherwise(pl.col("_targetObjects"))
            .alias("_targetObjects"),
            pl.when(pl.col("_qualifiers").is_null())
            .then(pl.lit([]).cast(pl.List(pl.Utf8)))
            .otherwise(pl.col("_qualifiers"))
            .alias("_qualifiers"),
        ]
    )

    return df


def load_events_from_json(json_path: str) -> pl.DataFrame:
    """
    Loads event data from a JSON OCEL file into a Polars DataFrame.

    Args:
        json_path (str): The path to the JSON OCEL file.

    Returns:
        pl.DataFrame: A DataFrame containing event data with columns
                      _eventId, _activity, _timestampUnix, _objects, and _qualifiers.
    """
    # Reads the file into a dict
    with open(json_path, "r") as f:
        data = json.load(f)
    events = data.get("events", [])
    # Build a DataFrame with id, type, timestamp and a list of related object IDs
    df = pl.DataFrame(
        {
            "_eventId": [e["id"] for e in events],
            "_activity": [e["type"] for e in events],
            "_timestamp_str": [e["time"] for e in events],
            "_objects": [
                [rel["objectId"] for rel in e.get("relationships", [])] for e in events
            ],
            "_qualifiers": [
                [rel["qualifier"] for rel in e.get("relationships", [])] for e in events
            ],
        }
    )

    # Convert the timestamp string to a datetime object and then to epoch seconds
    df = df.with_columns(
        pl.col("_timestamp_str").str.to_datetime().alias("_timestamp_datetime")
    )
    df = df.with_columns(
        pl.col("_timestamp_datetime").dt.epoch(time_unit="s").alias("_timestampUnix"),
    )

    df = df.select(
        ["_eventId", "_activity", "_timestampUnix", "_objects", "_qualifiers"]
    ).sort("_eventId")

    return df


def load_objects_from_json(json_path: str) -> pl.DataFrame:
    """
    Loads object data from a JSON OCEL file into a Polars DataFrame.

    Args:
        json_path (str): The path to the JSON OCEL file.

    Returns:
        pl.DataFrame: A DataFrame containing object data with columns
                      _objId, _objType, _targetObjects, and _qualifiers.
    """
    with open(json_path, "r") as f:
        data = json.load(f)
    objects = data.get("objects", [])
    df = pl.DataFrame(
        {
            "_objId": [o["id"] for o in objects],
            "_objType": [o["type"] for o in objects],
            "_targetObjects": [
                [rel["objectId"] for rel in o.get("relationships", [])] for o in objects
            ],
            "_qualifiers": [
                [rel["qualifier"] for rel in o.get("relationships", [])]
                for o in objects
            ],
        }
    )
    return df


def load_events_from_xml(xml_path: str) -> pl.DataFrame:
    """
    Loads event data from an XML OCEL file into a Polars DataFrame.

    Args:
        xml_path (str): The path to the XML OCEL file.

    Returns:
        pl.DataFrame: A DataFrame containing event data with columns
                      _eventId, _activity, _timestampUnix, _objects, and _qualifiers.
    """
    tree = ET.parse(xml_path)
    root = tree.getroot()

    ids = []
    types = []
    times = []
    target_obj_ids = []
    quals = []

    for ev in root.find("events").findall("event"):
        ids.append(ev.get("id"))
        types.append(ev.get("type"))
        times.append(ev.get("time"))

        # collect object-ids and qualifiers
        tmp_obj_ids = []
        tmp_quals = []
        objs_block = ev.find("objects")
        if objs_block is not None:
            # handle both <relationship> or <object> tags
            for r in objs_block:
                oid = r.get("object-id")
                if oid:
                    tmp_obj_ids.append(oid)
                    # qualifier may be on attribute "relationship" or "qualifier"
                    tmp_quals.append(r.get("relationship") or r.get("qualifier"))

        target_obj_ids.append(tmp_obj_ids)
        quals.append(tmp_quals)

    df = pl.DataFrame(
        {
            "_eventId": ids,
            "_activity": types,
            "_timestamp_str": times,
            "_objects": target_obj_ids,
            "_qualifiers": quals,
        }
    )

    # convert timestamp to epoch seconds
    df = df.with_columns(
        [
            pl.col("_timestamp_str").str.to_datetime().alias("_timestamp_datetime"),
            pl.col("_timestamp_str")
            .str.to_datetime()
            .dt.epoch(time_unit="s")
            .alias("_timestampUnix"),
        ]
    )

    return df.select(
        ["_eventId", "_activity", "_timestampUnix", "_objects", "_qualifiers"]
    ).sort("_eventId")


def load_objects_from_xml(xml_path: str) -> pl.DataFrame:
    """
    Loads object data from an XML OCEL file into a Polars DataFrame.

    Args:
        xml_path (str): The path to the XML OCEL file.

    Returns:
        pl.DataFrame: A DataFrame containing object data with columns
                      _objId, _objType, _targetObjects, and _qualifiers.
    """
    root = ET.parse(xml_path).getroot()

    rels = defaultdict(lambda: {"objType": None, "targets": [], "qualifiers": []})

    for src in root.findall("./objects/object"):
        src_id = src.get("id")
        src_type = src.get("type")

        if src_id is None:
            continue

        rels[src_id]["objType"] = src_type

        for ref in src.findall("./objects/relationship"):
            tgt_id = ref.get("object-id")
            if tgt_id is None:
                continue
            qualifier = ref.get("qualifier")
            rels[src_id]["targets"].append(tgt_id)
            rels[src_id]["qualifiers"].append(qualifier)

    rows = (
        {
            "_objId": oid,
            "_objType": data["objType"],
            "_targetObjects": data["targets"],
            "_qualifiers": data["qualifiers"],
        }
        for oid, data in rels.items()
    )

    return pl.DataFrame(
        rows,
        schema={
            "_objId": pl.Utf8,
            "_objType": pl.Utf8,
            "_targetObjects": pl.List(pl.Utf8),
            "_qualifiers": pl.List(pl.Utf8),
        },
    )


if __name__ == "__main__":
    # Testing SQLite
    print("Importing from SQLite...")
    events_df_sqlite = load_events_from_sqlite("example_data/ContainerLogistics.sqlite")
    print(events_df_sqlite)
    print("example row with no objects:")
    print(events_df_sqlite.filter(pl.col("_eventId") == "collect_hu10533"))
    objects_df_sqlite = load_objects_from_sqlite(
        "example_data/ContainerLogistics.sqlite"
    )
    print(objects_df_sqlite)
    print("example object with multiple targets:")
    print(objects_df_sqlite.filter(pl.col("_objId") == "cr1511"))

    # Testing JSON
    print("\nImporting from JSON...")
    events_df_json = load_events_from_json("example_data/ContainerLogistics.json")
    print(events_df_json)
    print("example row with no objects:")
    print(events_df_json.filter(pl.col("_eventId") == "collect_hu10533"))
    objects_df_json = load_objects_from_json("example_data/ContainerLogistics.json")
    print(objects_df_json)
    print("example object with multiple targets:")
    print(objects_df_sqlite.filter(pl.col("_objId") == "cr1511"))

    # Testing XML
    print("\nImporting from XML...")
    events_df_xml = load_events_from_xml("example_data/ContainerLogistics.xml")
    print(events_df_xml)
    print("example row with no objects:")
    print(events_df_xml.filter(pl.col("_eventId") == "collect_hu10533"))
    objects_df_xml = load_objects_from_xml("example_data/ContainerLogistics.xml")
    print(objects_df_xml)
    print("example object with multiple targets:")
    print(objects_df_sqlite.filter(pl.col("_objId") == "cr1511"))

    # log = ObjectCentricEventLog()
    # print(log.events)
