"""Query-parameter parsing and filtered-count SQL helpers.

Pure functions shared by the event-log endpoints; the only state is the
``db`` handle passed in.
"""


def _should_use_cache(request) -> bool:
    """Check if the request should use cache (default: True).

    Pass ``?bypass_cache=1`` or ``?bypass_cache=true`` to skip reading
    from the cache.  Results are **always stored** even on bypass so
    the next normal request benefits.
    """
    val = request.query_params.get("bypass_cache", "").lower()
    return val not in ("1", "true", "yes")


def _optional_int(value):
    if value in (None, ""):
        return None
    return int(value)


def _parse_filter_params(request):
    result = {}
    raw_ot = request.query_params.get("object_types", "")
    if raw_ot:
        result["object_types"] = [t.strip() for t in raw_ot.split(",") if t.strip()]
    raw_act = request.query_params.get("activities", "")
    if raw_act:
        result["activities"] = [a.strip() for a in raw_act.split(",") if a.strip()]
    raw_after = request.query_params.get("after")
    if raw_after:
        try:
            result["after"] = int(raw_after)
        except (ValueError, TypeError):
            pass
    raw_before = request.query_params.get("before")
    if raw_before:
        try:
            result["before"] = int(raw_before)
        except (ValueError, TypeError):
            pass
    return result


def _event_filter_base(fp):
    """Build the FROM + WHERE clause for event queries with full filter support.

    When object_types is present, returns a JOIN-based clause (with e. aliases).
    Otherwise returns a plain events WHERE clause (no aliases).
    Returns (from_where_sql, params, uses_aliases) where uses_aliases indicates
    whether column references need the "e." prefix.
    """
    uses_join = "object_types" in fp
    conditions, params = [], []

    if uses_join:
        if "after" in fp:
            conditions.append("e.timestamp_unix >= ?")
            params.append(fp["after"])
        if "before" in fp:
            conditions.append("e.timestamp_unix <= ?")
            params.append(fp["before"])
        if "activities" in fp:
            placeholders = ",".join("?" for _ in fp["activities"])
            conditions.append(f"e.activity IN ({placeholders})")
            params.extend(fp["activities"])
        placeholders = ",".join("?" for _ in fp["object_types"])
        conditions.append(f"o.obj_type IN ({placeholders})")
        params.extend(fp["object_types"])
        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        from_where = (
            f"FROM events e "
            f"JOIN event_object eo USING (event_id) "
            f"JOIN objects o ON o.obj_id = eo.obj_id "
            f"{where}"
        )
    else:
        if "after" in fp:
            conditions.append("timestamp_unix >= ?")
            params.append(fp["after"])
        if "before" in fp:
            conditions.append("timestamp_unix <= ?")
            params.append(fp["before"])
        if "activities" in fp:
            placeholders = ",".join("?" for _ in fp["activities"])
            conditions.append(f"activity IN ({placeholders})")
            params.extend(fp["activities"])
        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        from_where = f"FROM events {where}"

    return from_where, params, uses_join


def _filtered_event_counts(fp, db):
    """Return (num_events, num_unique_activities) respecting all active filters."""
    from_where, params, uses_join = _event_filter_base(fp)
    if uses_join:
        n_events = db.conn.execute(f"SELECT COUNT(DISTINCT e.event_id) {from_where}", params).fetchone()[0]
        n_acts   = db.conn.execute(f"SELECT COUNT(DISTINCT e.activity) {from_where}", params).fetchone()[0]
    else:
        n_events = db.conn.execute(f"SELECT COUNT(*) {from_where}", params).fetchone()[0]
        n_acts   = db.conn.execute(f"SELECT COUNT(DISTINCT activity) {from_where}", params).fetchone()[0]
    return n_events, n_acts


def _filtered_timestamp_range(fp, db):
    """Return (earliest_timestamp, newest_timestamp) respecting all active filters."""
    from_where, params, uses_join = _event_filter_base(fp)
    if uses_join:
        ts_sql = f"SELECT MIN(e.timestamp_unix), MAX(e.timestamp_unix) {from_where}"
    else:
        ts_sql = f"SELECT MIN(timestamp_unix), MAX(timestamp_unix) {from_where}"
    row = db.conn.execute(ts_sql, params).fetchone()
    return row if row else (None, None)


def _filtered_object_counts(fp, db):
    """Return (num_objects, num_object_types) respecting all active filters.

    When event-level filters (time range, activity) are present, counts only
    objects that participated in at least one matching event via the
    event_object join table.  Object-type filters narrow by obj_type in both
    cases.
    """
    has_event_filter = "after" in fp or "before" in fp or "activities" in fp
    has_type_filter = "object_types" in fp

    if not has_event_filter and not has_type_filter:
        n_obj = db.conn.execute("SELECT COUNT(*) FROM objects").fetchone()[0]
        n_types = db.conn.execute("SELECT COUNT(DISTINCT obj_type) FROM objects").fetchone()[0]
        return n_obj, n_types

    conditions, params = [], []
    if "after" in fp:
        conditions.append("e.timestamp_unix >= ?")
        params.append(fp["after"])
    if "before" in fp:
        conditions.append("e.timestamp_unix <= ?")
        params.append(fp["before"])
    if "activities" in fp:
        placeholders = ",".join("?" for _ in fp["activities"])
        conditions.append(f"e.activity IN ({placeholders})")
        params.extend(fp["activities"])
    if "object_types" in fp:
        placeholders = ",".join("?" for _ in fp["object_types"])
        conditions.append(f"o.obj_type IN ({placeholders})")
        params.extend(fp["object_types"])

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    base = (
        f"FROM event_object eo "
        f"JOIN events e USING (event_id) "
        f"JOIN objects o ON o.obj_id = eo.obj_id "
        f"{where}"
    )
    n_obj = db.conn.execute(f"SELECT COUNT(DISTINCT eo.obj_id) {base}", params).fetchone()[0]
    n_types = db.conn.execute(f"SELECT COUNT(DISTINCT o.obj_type) {base}", params).fetchone()[0]
    return n_obj, n_types
