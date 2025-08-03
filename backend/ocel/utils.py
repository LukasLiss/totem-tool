import polars as pl
from typing import List, Tuple, Dict
import sqlite3

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
    
def eventsFromSQLite(file_path: str) -> pl.DataFrame:
    
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

    # access a row "collect_hu10533" where there is no object
    # print(df.filter(pl.col("_eventId") == "collect_hu10533"))

    df = df.with_columns(
        pl.col("_timestamp_str").str.to_datetime().alias("_timestamp_datetime")
    )   
    df = df.with_columns(
        pl.col("_timestamp_datetime").dt.epoch(time_unit="s").alias("_timestamp_epoch_s"),
    )

    return df

def objectsFromSQLite(file_path: str) -> pl.DataFrame:
    query = """
        SELECT o.ocel_id as _object, omt.ocel_type_map as _type FROM
        object o JOIN object_map_type omt on o.ocel_type = omt.ocel_type    
    """
    con = sqlite3.connect(file_path)
    df = pl.read_database(query=query, connection=con)
    con.close()

    return df

if __name__ == "__main__":

    events_df = eventsFromSQLite("ocel/resources/ContainerLogistics.sqlite")
    events_df = events_df.drop(["_timestamp_str", "_timestamp_datetime", "_qualifiers"])
    events_df = events_df.rename({"_timestamp_epoch_s": "_timestampUnix"})
    print(events_df)

    objects_df = objectsFromSQLite("ocel/resources/ContainerLogistics.sqlite")
    print(objects_df)

    # log = ObjectCentricEventLog()
    # print(log.events)