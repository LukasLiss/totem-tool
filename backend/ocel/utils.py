import polars as pl
from typing import List, Tuple, Dict
import sqlite3
import json
import xml.etree.ElementTree as ET

class ObjectCentricEventLog:
    def __init__(self):
        # Main events dataframe
        self.events = pl.DataFrame(schema={
            "_eventId": pl.Utf8,
            "_activity": pl.Utf8,
            "_timestampUnix": pl.Int64,
            "_objects": pl.List(pl.Utf8)
        })
        
        # Object types dataframe
        self.object_types = pl.DataFrame(schema={
            "_objId": pl.Utf8,
            "_objType": pl.Utf8
        })
        
        # Store additional attributes
        self.event_attributes: Dict[str, pl.DataFrame] = {}
        self.object_attributes: Dict[str, Dict[str, List[Tuple[int, str]]]] = {}

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
        self.object_types = pl.concat([self.object_types, new_object])

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
            ocel_type_map as _activity,
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
    
    # turn null values in _object and _qualifier to empty strings
    # df = df.with_columns([
    #     pl.col("_object").fill_null(""),
    #     pl.col("_qualifier").fill_null("")
    # ])

    df = df.group_by("_eventId").agg([pl.col("_object").alias("_objects"), pl.col("_qualifier").alias("_qualifiers"), pl.col("_activity").first(), pl.col("_timestamp_str").first()])

    # Convert the timestamp string to a datetime object and then to epoch seconds
    df = df.with_columns(
        pl.col("_timestamp_str").str.to_datetime().alias("_timestamp_datetime")
    )   
    df = df.with_columns(
        pl.col("_timestamp_datetime").dt.epoch(time_unit="s").alias("_timestampUnix"),
    )

    df = df.drop(["_timestamp_str", "_timestamp_datetime", "_qualifiers"])

    return df

def load_objects_from_sqlite(file_path: str) -> pl.DataFrame:
    query = """
        SELECT o.ocel_id as _objId, omt.ocel_type_map as _objType FROM
        object o JOIN object_map_type omt on o.ocel_type = omt.ocel_type    
    """
    con = sqlite3.connect(file_path)
    df = pl.read_database(query=query, connection=con)
    con.close()

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
    })

    # Convert the timestamp string to a datetime object and then to epoch seconds
    df = df.with_columns(
        pl.col("_timestamp_str").str.to_datetime().alias("_timestamp_datetime")
    )   
    df = df.with_columns(
        pl.col("_timestamp_datetime").dt.epoch(time_unit="s").alias("_timestampUnix"),
    )

    df = df.drop("_timestamp_str", "_timestamp_datetime")
    return df

def load_objects_from_json(json_path: str) -> pl.DataFrame:
    with open(json_path, "r") as f:
        data = json.load(f)
    objects = data.get("objects", [])
    df = pl.DataFrame({
        "_objId":   [o["id"]   for o in objects],
        "_objType": [o["type"] for o in objects],
    })
    return df

def load_events_from_xml(xml_path: str) -> pl.DataFrame:
    tree = ET.parse(xml_path)
    root = tree.getroot()

    ids = []
    types = []
    times = []
    rels = []

    for ev in root.find("events").findall("event"):
        ids.append(ev.get("id"))
        types.append(ev.get("type"))
        times.append(ev.get("time"))

        rel_list = []
        objs_block = ev.find("objects")
        if objs_block is not None:
            for r in objs_block.findall("relationship"):
                rel_list.append(r.get("object-id"))
        rels.append(rel_list)

    df = pl.DataFrame({
        "_eventId":                  ids,
        "_activity":                types,
        "_timestamp_str":           times,
        "_objects":  rels
    })

    # Convert the timestamp string to a datetime object and then to epoch seconds
    df = df.with_columns(
        pl.col("_timestamp_str").str.to_datetime().alias("_timestamp_datetime")
    )   
    df = df.with_columns(
        pl.col("_timestamp_datetime").dt.epoch(time_unit="s").alias("_timestampUnix"),
    )

    df = df.drop("_timestamp_str", "_timestamp_datetime")
    return df


def load_objects_from_xml(xml_path: str) -> pl.DataFrame:
    tree = ET.parse(xml_path)
    root = tree.getroot()

    ids = []
    types = []

    for obj in root.find("objects").findall("object"):
        ids.append(obj.get("id"))
        types.append(obj.get("type"))

    df = pl.DataFrame({
        "_objId":   ids,
        "_objType": types
    })
    return df



if __name__ == "__main__":

    print("Importing from SQLite...")
    events_df_sqlite = load_events_from_sqlite("ocel/resources/ContainerLogistics.sqlite")
    print(events_df_sqlite)
    print("example row with no objects:")
    print(events_df_sqlite.filter(pl.col("_eventId") == "collect_hu10533"))
    objects_df_sqlite = load_objects_from_sqlite("ocel/resources/ContainerLogistics.sqlite")
    print(objects_df_sqlite)

    print("\nImporting from JSON...")
    events_df_json = load_events_from_json("ocel/resources/ContainerLogistics.json")
    print(events_df_json)
    print("example row with no objects:")
    print(events_df_json.filter(pl.col("_eventId") == "collect_hu10533"))
    objects_df_json = load_objects_from_json("ocel/resources/ContainerLogistics.json")
    print(objects_df_json)


    print("\nImporting from XML...")
    events_df_xml = load_events_from_xml("ocel/resources/ContainerLogistics.xml")
    print(events_df_xml)
    print("example row with no objects:")
    print(events_df_xml.filter(pl.col("_eventId") == "collect_hu10533"))
    objects_df_xml = load_objects_from_xml("ocel/resources/ContainerLogistics.xml")
    print(objects_df_xml)
    

    # log = ObjectCentricEventLog()
    # print(log.events)