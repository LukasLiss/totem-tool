import polars as pl
from typing import List, Tuple, Dict
from types import SimpleNamespace
import networkx as nx
import sqlite3
import json
import xml.etree.ElementTree as ET
from datetime import datetime
from collections import defaultdict
from functools import cached_property
# DATEFORMAT = "%Y-%m-%dT%H:%M:%S.%fZ"  # ISO 8601 format with milliseconds
DATEFORMAT = "%Y-%m-%d %H:%M:%S"

class ObjectCentricEventLog:
    def __init__(self):
        # Main events dataframe
        self.events = pl.DataFrame(schema={
            "_eventId": pl.Utf8,
            "_activity": pl.Utf8,
            "_timestampUnix": pl.Int64,
            "_objects": pl.List(pl.Utf8),
            "_qualifiers": pl.List(pl.Utf8)
        })
        
        # Object types dataframe
        self.object_df = pl.DataFrame(schema={
            "_objId": pl.Utf8,
            "_objType": pl.Utf8,
            "_targetObjects": pl.List(pl.Utf8),
            "_qualifiers": pl.List(pl.Utf8)
        })
        
        # Store additional attributes
        self.event_attributes: Dict[str, pl.DataFrame] = {}
        self.object_attributes: Dict[str, Dict[str, List[Tuple[int, str]]]] = {}

        # cache for the object type mappings
        self._obj_type_map: dict[str,str] | None = None

        # empty object‐to‐object graph
        self.o2o_graph = SimpleNamespace(graph=nx.DiGraph())

    def add_event(self, event_id: str, activity: str, timestamp: int, objects: List[str]) -> None:
        new_event = pl.DataFrame([{
            "_eventId": event_id,
            "_activity": activity,
            "_timestampUnix": timestamp,
            "_objects": objects
        }])
        self.events = pl.concat([self.events, new_event])

    def add_object(self, obj_id: str, obj_type: str) -> None:
        new_object = pl.DataFrame([{
            "_objId": obj_id,
            "_objType": obj_type
        }])
        self.object_df = pl.concat([self.object_df, new_object])

    def _build_obj_type_map(self):
        # only called once
        self._obj_type_map = dict(
            zip(
              self.object_df["_objId"].to_list(),
              self.object_df["_objType"].to_list()
            )
        )
    
    @cached_property
    def o2o_graph_edges(self) -> List[Tuple[str, str]]:
        """
        Returns the object-to-object graph edges.
        Each edge is a tuple (source_object_id, target_object_id).
        """
        objects_ungrouped_df = self.object_df.explode(["_targetObjects", "_qualifiers"]).select(
            pl.col("_objId").alias("source"),
            pl.col("_targetObjects").alias("target"),
        ).drop_nulls()
        return objects_ungrouped_df.rows()


    @cached_property
    def event_cache(self) -> Dict[str, dict]:
        """
        Returns a cache of events attributes
        The keys are event IDs and the values are dictionaries of attributes.
        """
        ev_cache = {}
        
        events_iter = self.events.select([
            "_eventId", "_activity", "_timestampUnix", "_objects"
        ]).iter_rows(named=True)
        
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
                "objects_by_type": dict(objects_by_type)
            }
        return ev_cache


    @property
    def obj_type_map(self) -> dict[str,str]:
        if self._obj_type_map is None:
            self._build_obj_type_map()
        return self._obj_type_map

    @property
    def object_types(self) -> list[str]:
        # list of all known object‐type names
        # return list(set(self._obj_type_map.values()))
        return list(set(self.object_df["_objType"]))

    @property
    def process_executions(self) -> list[list[str]]:
        # just return one case containing all events
        # for compatibility with the original interface
        return [ self.events["_eventId"].to_list() ]

    def get_value(self, event_id: str, attribute: str):
        """
        Optimized interface for the totem miner.
        Uses cached data for fast lookups.
        """

        event_data = self.event_cache.get(event_id)
        if event_data is None:
            return None

        if attribute == "event_timestamp":
            # return datetime.utcfromtimestamp(ts_unix).strftime(DATEFORMAT)
            return event_data["timestamp"]  # just use unix since temporal order is preserved
        elif attribute == "event_activity":
            return event_data["activity"]
        elif attribute == "event_objects":
            return event_data["objects"]
        else:
            # otherwise attribute == some object_type → filter
            return event_data["objects_by_type"].get(attribute, [])

    
    


class OcelFileImporter:
    """
    Class to import OCEL 2.0 files into the ObjectCentricEventLog structure.
    Supports SQLite, JSON, and XML formats.
    Docs: www.ocel-standard.org
    """
    def __init__(self, file_path: str, file_format: str = "sqlite"):
        self.file_path = file_path
        self.file_format = file_format
        self.event_log = ObjectCentricEventLog()
    
    def import_file(self) -> ObjectCentricEventLog:
        if self.file_format == "sqlite":
            return self._import_sqlite()
        elif self.file_format == "json":
            return self._import_json()
        elif self.file_format == "xml":
            return self._import_xml()
        else:
            raise ValueError(f"Unsupported file format: {self.file_format}. Please use 'sqlite', 'json', or 'xml'.")

    def _import_sqlite(self) -> ObjectCentricEventLog:
        # Todo
        return self.event_log             

    def _import_json(self) -> ObjectCentricEventLog:
        # Placeholder for JSON import logic
        return self.event_log

    def _import_xml(self) -> ObjectCentricEventLog:
        # Placeholder for XML import logic   
        return self.event_log
    
def load_events_from_sqlite(file_path: str) -> pl.DataFrame:
    
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
    event_object_query ="""
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
    df = df.group_by("_eventId").agg([pl.col("_object").alias("_objects"), pl.col("_qualifier").alias("_qualifiers"), pl.col("_activity").first(), pl.col("_timestamp_str").first()])

    # transform [null] to empty list []
    df = df.with_columns(_objects=pl.col("_objects").list.drop_nulls(), _qualifiers=pl.col("_qualifiers").list.drop_nulls())

    # Convert the timestamp string to a datetime object and then to epoch seconds
    df = df.with_columns(
        pl.col("_timestamp_str").str.to_datetime().alias("_timestamp_datetime")
    )   
    df = df.with_columns(
        pl.col("_timestamp_datetime").dt.epoch(time_unit="s").alias("_timestampUnix"),
    )

    df = df.select(["_eventId", "_activity", "_timestampUnix", "_objects", "_qualifiers"]).sort("_eventId")

    return df

def load_objects_from_sqlite(file_path: str) -> pl.DataFrame:
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
        df_rel
        .group_by("_objId")
        .agg([
            pl.col("ocel_target_id").alias("_targetObjects"),
            pl.col("ocel_qualifier").alias("_qualifiers")
        ])
        .with_columns([
            pl.col("_targetObjects").list.drop_nulls().alias("_targetObjects"),
            pl.col("_qualifiers").list.drop_nulls().alias("_qualifiers")
        ])
    )

    df = (
        df_objs
        .join(df_targets, on="_objId", how="left")
        .with_columns([
            pl.when(pl.col("_targetObjects").is_null())
              .then(pl.lit([]).cast(pl.List(pl.Utf8)))
              .otherwise(pl.col("_targetObjects"))
              .alias("_targetObjects"),
            pl.when(pl.col("_qualifiers").is_null())
              .then(pl.lit([]).cast(pl.List(pl.Utf8)))
              .otherwise(pl.col("_qualifiers"))
              .alias("_qualifiers"),
        ])
    )

    return df


def load_events_from_json(json_path: str) -> pl.DataFrame:
    # Reads the file into a dict
    with open(json_path, "r") as f:
        data = json.load(f)
    events = data.get("events", [])
    # Build a DataFrame with id, type, timestamp and a list of related object IDs
    df = pl.DataFrame({
        "_eventId":              [e["id"]               for e in events],
        "_activity":            [e["type"]             for e in events],
        "_timestamp_str":       [e["time"]             for e in events],
        "_objects": [
            [rel["objectId"] for rel in e.get("relationships", [])]
            for e in events
        ],
        "_qualifiers": [
            [rel["qualifier"] for rel in e.get("relationships", [])]
            for e in events
        ]
    })

    # Convert the timestamp string to a datetime object and then to epoch seconds
    df = df.with_columns(
        pl.col("_timestamp_str").str.to_datetime().alias("_timestamp_datetime")
    )   
    df = df.with_columns(
        pl.col("_timestamp_datetime").dt.epoch(time_unit="s").alias("_timestampUnix"),
    )

    df = df.select(["_eventId", "_activity", "_timestampUnix", "_objects", "_qualifiers"]).sort("_eventId")

    return df

def load_objects_from_json(json_path: str) -> pl.DataFrame:
    with open(json_path, "r") as f:
        data = json.load(f)
    objects = data.get("objects", [])
    df = pl.DataFrame({
        "_objId":   [o["id"]   for o in objects],
        "_objType": [o["type"] for o in objects],
        "_targetObjects": [
            [rel["objectId"] for rel in o.get("relationships", [])]
            for o in objects
        ],
        "_qualifiers": [
            [rel["qualifier"] for rel in o.get("relationships", [])]
            for o in objects
        ]
    })
    return df

def load_events_from_xml(xml_path: str) -> pl.DataFrame:
    tree = ET.parse(xml_path)
    root = tree.getroot()

    ids       = []
    types     = []
    times     = []
    target_obj_ids      = []  
    quals     = []  

    for ev in root.find("events").findall("event"):
        ids.append(ev.get("id"))
        types.append(ev.get("type"))
        times.append(ev.get("time"))

        # collect object-ids and qualifiers
        tmp_obj_ids   = []
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

    df = pl.DataFrame({
        "_eventId":        ids,
        "_activity":       types,
        "_timestamp_str":  times,
        "_objects":        target_obj_ids,
        "_qualifiers":     quals, 
    })

    # convert timestamp to epoch seconds
    df = df.with_columns([
        pl.col("_timestamp_str").str.to_datetime().alias("_timestamp_datetime"),
        pl.col("_timestamp_str")
          .str.to_datetime()
          .dt.epoch(time_unit="s")
          .alias("_timestampUnix"),
    ])


    return (
      df
      .select(["_eventId","_activity","_timestampUnix","_objects","_qualifiers"])
      .sort("_eventId")
    )


def load_objects_from_xml(xml_path: str) -> pl.DataFrame:
    root = ET.parse(xml_path).getroot()

    rels = defaultdict(lambda: {"objType": None,
                                "targets": [],
                                "qualifiers": []})

    for src in root.findall("./objects/object"):
        src_id   = src.get("id")
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
        {"_objId": oid,
         "_objType": data["objType"],
         "_targetObjects": data["targets"],
         "_qualifiers": data["qualifiers"]}
        for oid, data in rels.items()
    )

    return pl.DataFrame(rows,
                        schema={
                            "_objId": pl.Utf8,
                            "_objType": pl.Utf8,
                            "_targetObjects": pl.List(pl.Utf8),
                            "_qualifiers": pl.List(pl.Utf8),
                        })



if __name__ == "__main__":

    # Testing SQLite
    print("Importing from SQLite...")
    events_df_sqlite = load_events_from_sqlite("example_data/ContainerLogistics.sqlite")
    print(events_df_sqlite)
    print("example row with no objects:")
    print(events_df_sqlite.filter(pl.col("_eventId") == "collect_hu10533"))
    objects_df_sqlite = load_objects_from_sqlite("example_data/ContainerLogistics.sqlite")
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