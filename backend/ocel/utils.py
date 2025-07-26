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
        with sqlite3.connect(self.file_path) as conn:
            # Import events and their basic attributes
            events_query = "SELECT ocel_id, ocel_type FROM event"
            events_df = pl.read_database(query=events_query, connection=conn)
            
            # Get event types for dynamic tables
            types_query = "SELECT ocel_type_map FROM event_map_type"
            event_types = pl.read_database(query=types_query, connection=conn)
            
            # Import event-object relationships
            rel_query = "SELECT ocel_event_id, ocel_object_id FROM event_object"
            event_object_df = pl.read_database(query=rel_query, connection=conn)
            
            # Process each event
            for row in events_df.iter_rows():
                event_id = row[0]  # ocel_id
                activity = row[1]  # ocel_type
                
                # Get timestamp from corresponding event type table
                timestamp_query = f"""
                    SELECT ocel_time 
                    FROM event_{activity} 
                    WHERE ocel_id = '{event_id}'
                """
                timestamp_df = pl.read_database(query=timestamp_query, connection=conn)
                timestamp = int(pl.from_pandas(pd.to_datetime(timestamp_df[0,0])).timestamp())
                
                # Get related objects
                objects = (event_object_df
                          .filter(pl.col("ocel_event_id") == event_id)
                          .select("ocel_object_id")
                          .to_series()
                          .to_list())
                
                # Add event to log
                self.event_log.add_event(event_id, activity, timestamp, objects)

            # Import objects and their types
            objects_query = "SELECT ocel_id as object_id, ocel_type FROM object"
            objects_df = pl.read_database(query=objects_query, connection=conn)
            
            for row in objects_df.iter_rows():
                obj_id = row[0]
                obj_type = row[1]
                self.event_log.add_object(obj_id, obj_type)

            # Import object attributes
            type_query = "SELECT DISTINCT ocel_type FROM object"
            object_types = pl.read_database(query=type_query, connection=conn)
            
            map_query = "SELECT ocel_type, ocel_type_map FROM object_map_type"
            object_map_types = pl.read_database(query=map_query, connection=conn)
            
            # Process each object type's attributes
            for obj_type in object_types["ocel_type"]:
                type_map = (object_map_types
                           .filter(pl.col("ocel_type") == obj_type)
                           .select("ocel_type_map")
                           .item())
                
                attr_query = f"SELECT * FROM object_{type_map}"
                attr_df = pl.read_database(query=attr_query, connection=conn)
                
                # Process attributes for this object type
                for column in attr_df.columns:
                    if column not in ["ocel_id", "ocel_type"]:
                        if obj_type not in self.event_log.object_attributes:
                            self.event_log.object_attributes[obj_type] = {}
                        
                        self.event_log.object_attributes[obj_type][column] = []
                        
                        # Add non-null attribute values
                        for attr_row in attr_df.select([
                            "ocel_id", 
                            pl.col(column).alias("value")
                        ]).filter(pl.col("value").is_not_null()).iter_rows():
                            self.event_log.object_attributes[obj_type][column].append(
                                (int(pl.now().timestamp()), str(attr_row[1]))
                            )

        return self.event_log             

    def _import_json(self) -> ObjectCentricEventLog:
        # Placeholder for JSON import logic
        return self.event_log

    def _import_xml(self) -> ObjectCentricEventLog:
        # Placeholder for XML import logic   
        return self.event_log
