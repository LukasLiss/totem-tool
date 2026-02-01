import polars as pl
import sqlite3
import json
import xml.etree.ElementTree as ET
import os
import re
from collections import defaultdict
from . import ObjectCentricEventLog


def import_ocel(file_path: str, file_format: str = None) -> ObjectCentricEventLog:
    """
    Imports an OCEL 2.0 file and returns an ObjectCentricEventLog.

    Args:
        file_path (str): The path to the OCEL file.
        file_format (str, optional): The format of the OCEL file. Must be one of "sqlite", "json", "xml", or "csv".

    Returns:
        ObjectCentricEventLog: The imported object-centric event log.
    """
    if file_format is None:
        extension_map = {".sqlite": "sqlite", ".json": "json", ".xml": "xml", ".csv": "csv"}
        _, ext = os.path.splitext(file_path)
        file_format = extension_map.get(ext.lower())
        if file_format is None:
            raise ValueError(
                f"Could not infer file format from extension '{ext}'."
                f"Please specify the file_format parameter, or use one of {list(extension_map.values())}."
            )

    if file_format == "csv":
        return import_ocel_from_csv(file_path)

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


def import_ocel_from_csv(file_path: str) -> ObjectCentricEventLog:
    """
    Imports an OCEL from a CSV file and returns an ObjectCentricEventLog.

    The CSV file must have columns: id, activity, timestamp, and optionally:
    - Object type columns (prefix "ot:", e.g., "ot:order", "ot:item")
    - Event attribute columns (prefix "ea:", e.g., "ea:billable", "ea:area")

    Rows can be:
    - Events: id is event ID, activity is not empty and not "o2o"
    - Object attribute updates: activity is empty
    - Object-to-object relations: activity is "o2o"

    Object format in cells: objId[#qualifier][{json_attributes}]
    Multiple objects separated by "/".

    Args:
        file_path (str): The path to the CSV file.

    Returns:
        ObjectCentricEventLog: The imported object-centric event log with events,
                              objects, and object_attributes dataframes.
    """
    # Read the CSV file
    df = pl.read_csv(file_path)

    # Identify column types
    ot_columns = [col for col in df.columns if col.startswith("ot:")]
    ea_columns = [col for col in df.columns if col.startswith("ea:")]

    # Initialize data structures
    events_data = []
    objects_data = defaultdict(lambda: {"type": None, "targets": [], "qualifiers": []})
    object_attributes_data = []

    # Helper function to parse object string
    def parse_object_string(obj_str: str) -> tuple:
        """
        Parses an object string like "i1#part-of{\"price\": \"5€\"}"
        Returns (object_id, qualifier, attributes_dict)
        """
        if not obj_str or obj_str.strip() == "":
            return None, None, None

        obj_str = obj_str.strip()

        # Extract JSON attributes if present
        attributes = None
        json_match = re.search(r'\{.*\}', obj_str)
        if json_match:
            json_str = json_match.group(0)
            # Replace smart quotes with regular quotes for valid JSON
            # U+201C (") and U+201D (") are left and right double quotation marks
            # U+2018 (') and U+2019 (') are left and right single quotation marks
            json_str = json_str.replace('\u201c', '"').replace('\u201d', '"').replace('\u2018', "'").replace('\u2019', "'")
            try:
                attributes = json.loads(json_str)
            except json.JSONDecodeError:
                attributes = None
            # Remove JSON from obj_str
            obj_str = obj_str[:json_match.start()].strip()

        # Extract qualifier if present
        qualifier = None
        if "#" in obj_str:
            parts = obj_str.split("#", 1)
            obj_id = parts[0].strip()
            qualifier = parts[1].strip() if len(parts) > 1 else None
        else:
            obj_id = obj_str.strip()

        return obj_id, qualifier, attributes

    # Process each row
    for row in df.iter_rows(named=True):
        row_id = row.get("id", "").strip() if row.get("id") else ""
        activity = row.get("activity", "").strip() if row.get("activity") else ""
        timestamp_str = row.get("timestamp", "").strip() if row.get("timestamp") else ""

        # Determine row type
        is_o2o = activity == "o2o"
        is_obj_attr_update = activity == "" and not is_o2o
        is_event = activity != "" and not is_o2o

        # Parse timestamp
        timestamp_unix = None
        if timestamp_str:
            try:
                timestamp_unix = int(pl.Series([timestamp_str]).str.to_datetime().dt.epoch(time_unit="s")[0])
            except Exception:
                timestamp_unix = 0

        if is_event:
            # Process event row
            event_objects = []
            event_qualifiers = []
            event_attributes = {}

            # Collect event attributes
            for ea_col in ea_columns:
                ea_value = row.get(ea_col, "")
                if ea_value and str(ea_value).strip() != "":
                    attr_key = ea_col[3:]  # Remove "ea:" prefix
                    event_attributes[attr_key] = str(ea_value).strip()

            # Process object type columns
            for ot_col in ot_columns:
                obj_type = ot_col[3:]  # Remove "ot:" prefix
                cell_value = row.get(ot_col, "")
                if not cell_value or str(cell_value).strip() == "":
                    continue

                # Split by "/" for multiple objects
                obj_strings = str(cell_value).split("/")
                for obj_str in obj_strings:
                    obj_id, qualifier, attributes = parse_object_string(obj_str)
                    if obj_id:
                        event_objects.append(obj_id)
                        event_qualifiers.append(qualifier if qualifier else "")

                        # Register object type
                        if objects_data[obj_id]["type"] is None:
                            objects_data[obj_id]["type"] = obj_type

                        # If object has attributes, record them for object_attributes
                        if attributes and timestamp_unix is not None:
                            object_attributes_data.append({
                                "_objId": obj_id,
                                "_timestampUnix": timestamp_unix,
                                "_jsonObjAttributes": json.dumps(attributes)
                            })

            events_data.append({
                "_eventId": row_id,
                "_activity": activity,
                "_timestampUnix": timestamp_unix,
                "_objects": event_objects,
                "_qualifiers": event_qualifiers,
                "_attributes": json.dumps(event_attributes) if event_attributes else ""
            })

        elif is_obj_attr_update:
            # Process object attribute update row
            for ot_col in ot_columns:
                obj_type = ot_col[3:]
                cell_value = row.get(ot_col, "")
                if not cell_value or str(cell_value).strip() == "":
                    continue

                obj_strings = str(cell_value).split("/")
                for obj_str in obj_strings:
                    obj_id, qualifier, attributes = parse_object_string(obj_str)
                    if obj_id and attributes and timestamp_unix is not None:
                        # Register object type if not already registered
                        if objects_data[obj_id]["type"] is None:
                            objects_data[obj_id]["type"] = obj_type

                        object_attributes_data.append({
                            "_objId": obj_id,
                            "_timestampUnix": timestamp_unix,
                            "_jsonObjAttributes": json.dumps(attributes)
                        })

        elif is_o2o:
            # Process object-to-object relationship row
            source_obj_id = row_id

            for ot_col in ot_columns:
                obj_type = ot_col[3:]
                cell_value = row.get(ot_col, "")
                if not cell_value or str(cell_value).strip() == "":
                    continue

                obj_strings = str(cell_value).split("/")
                for obj_str in obj_strings:
                    obj_id, qualifier, _ = parse_object_string(obj_str)
                    if obj_id:
                        # Register target object type
                        if objects_data[obj_id]["type"] is None:
                            objects_data[obj_id]["type"] = obj_type

                        # Add relationship from source to target
                        if source_obj_id not in objects_data:
                            objects_data[source_obj_id]["type"] = "UNKNOWN"  # Will be updated if found
                        objects_data[source_obj_id]["targets"].append(obj_id)
                        objects_data[source_obj_id]["qualifiers"].append(qualifier if qualifier else "")

    # Create events DataFrame
    events_df = pl.DataFrame(events_data, schema={
        "_eventId": pl.Utf8,
        "_activity": pl.Utf8,
        "_timestampUnix": pl.Int64,
        "_objects": pl.List(pl.Utf8),
        "_qualifiers": pl.List(pl.Utf8),
        "_attributes": pl.Utf8,
    })

    # Create objects DataFrame
    objects_rows = [
        {
            "_objId": obj_id,
            "_objType": data["type"] if data["type"] else "UNKNOWN",
            "_targetObjects": data["targets"],
            "_qualifiers": data["qualifiers"],
        }
        for obj_id, data in objects_data.items()
    ]
    objects_df = pl.DataFrame(objects_rows, schema={
        "_objId": pl.Utf8,
        "_objType": pl.Utf8,
        "_targetObjects": pl.List(pl.Utf8),
        "_qualifiers": pl.List(pl.Utf8),
    })

    # Create object_attributes DataFrame
    if object_attributes_data:
        object_attributes_df = pl.DataFrame(object_attributes_data, schema={
            "_objId": pl.Utf8,
            "_timestampUnix": pl.Int64,
            "_jsonObjAttributes": pl.Utf8,
        })
    else:
        object_attributes_df = pl.DataFrame(schema={
            "_objId": pl.Utf8,
            "_timestampUnix": pl.Int64,
            "_jsonObjAttributes": pl.Utf8,
        })

    return ObjectCentricEventLog(
        events=events_df,
        objects=objects_df,
        object_attributes=object_attributes_df
    )


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
