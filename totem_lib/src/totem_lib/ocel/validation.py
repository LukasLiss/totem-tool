import duckdb

class OCELValidationException(Exception):
    def __init__(self, errors: list[str]):
        self.errors = errors
        super().__init__("\n".join(errors))

def validate_ocel(conn: duckdb.DuckDBPyConnection) -> list[str]:
    """
    Runs structural checks on an OCEL database and returns a list of error strings.
    If no errors are found, returns an empty list.
    """
    errors = []
    max_errors_per_type = 10

    # 1. Check mandatory tables exist
    required_tables = ["events", "objects", "event_object", "object_relations", "object_attribute_history"]
    existing_tables_res = conn.execute("SELECT table_name FROM information_schema.tables").fetchall()
    existing_tables = {row[0] for row in existing_tables_res}

    for table in required_tables:
        if table not in existing_tables:
            errors.append(f"Validation Failed: Mandatory table '{table}' is missing.")

    if errors:
        return errors  # Cannot proceed with deep checks if tables are missing

    # 2. Check empty logs
    num_events = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
    num_objects = conn.execute("SELECT COUNT(*) FROM objects").fetchone()[0]

    if num_events == 0:
        errors.append("Validation Failed: Event log contains no events.")
    if num_objects == 0:
        errors.append("Validation Failed: Event log contains no objects.")

    if errors:
        return errors # No need to check foreign keys if empty

    # 3. Check for NULL timestamps
    null_ts = conn.execute("SELECT COUNT(*) FROM events WHERE timestamp_unix IS NULL").fetchone()[0]
    if null_ts > 0:
        errors.append(f"Validation Failed: Found {null_ts} events with missing or invalid timestamps.")

    # 4. Foreign Key Integrity
    # 4a. event_object -> events
    dangling_eo_ev = conn.execute("""
        SELECT event_id FROM event_object 
        WHERE event_id NOT IN (SELECT event_id FROM events)
        LIMIT ?
    """, [max_errors_per_type]).fetchall()
    for (ev_id,) in dangling_eo_ev:
        errors.append(f"Validation Failed: Event-Object relation references missing Event '{ev_id}'.")

    # 4b. event_object -> objects
    dangling_eo_obj = conn.execute("""
        SELECT event_id, obj_id FROM event_object 
        WHERE obj_id NOT IN (SELECT obj_id FROM objects)
        LIMIT ?
    """, [max_errors_per_type]).fetchall()
    for ev_id, obj_id in dangling_eo_obj:
        errors.append(f"Validation Failed: Event '{ev_id}' references missing Object '{obj_id}'.")

    # 4c. object_relations -> objects (source)
    dangling_rel_src = conn.execute("""
        SELECT source_obj_id FROM object_relations 
        WHERE source_obj_id NOT IN (SELECT obj_id FROM objects)
        LIMIT ?
    """, [max_errors_per_type]).fetchall()
    for (obj_id,) in dangling_rel_src:
        errors.append(f"Validation Failed: Object Relation references missing Source Object '{obj_id}'.")

    # 4d. object_relations -> objects (target)
    dangling_rel_tgt = conn.execute("""
        SELECT target_obj_id FROM object_relations 
        WHERE target_obj_id NOT IN (SELECT obj_id FROM objects)
        LIMIT ?
    """, [max_errors_per_type]).fetchall()
    for (obj_id,) in dangling_rel_tgt:
        errors.append(f"Validation Failed: Object Relation references missing Target Object '{obj_id}'.")

    # 4e. object_attribute_history -> objects
    dangling_hist = conn.execute("""
        SELECT DISTINCT obj_id FROM object_attribute_history 
        WHERE obj_id NOT IN (SELECT obj_id FROM objects)
        LIMIT ?
    """, [max_errors_per_type]).fetchall()
    for (obj_id,) in dangling_hist:
        errors.append(f"Validation Failed: Attribute History references missing Object '{obj_id}'.")

    return errors
