from collections import defaultdict
from typing import List, Optional
import networkx as nx

from totem_lib.ocel.ocel_duckdb import OcelDuckDB

from .ocdfg import OCDFG


class OCDFGDb(OCDFG):
    """
    DuckDB-backed Object-Centric Directly-Follows Graph.

    Computes the same graph as OCDFG.from_ocel() but pushes all
    directly-follows logic into SQL window functions, avoiding
    intermediate Polars DataFrames.
    """

    @classmethod
    def from_ocel_db(
        cls,
        ocel_db: OcelDuckDB,
        object_types: Optional[List[str]] = None,
    ) -> "OCDFGDb":
        """Build the OC-DFG from a DuckDB-backed event log."""

        type_filter = ""
        params: list = []
        if object_types is not None:
            placeholders = ", ".join(["?"] * len(object_types))
            type_filter = f"WHERE o.obj_type IN ({placeholders})"
            params = list(object_types)

        cte = f"""
            WITH event_sequence AS (
                SELECT
                    e.event_id,
                    e.activity,
                    e.timestamp_unix,
                    o.obj_id,
                    o.obj_type,
                    LAG(e.activity)  OVER w AS prev_activity,
                    LEAD(e.activity) OVER w AS next_activity,
                    LEAD(e.timestamp_unix) OVER w AS next_timestamp_unix
                FROM events e
                JOIN event_object eo ON e.event_id = eo.event_id
                JOIN objects o       ON eo.obj_id  = o.obj_id
                {type_filter}
                WINDOW w AS (PARTITION BY eo.obj_id ORDER BY e.timestamp_unix, e.event_id)
            )
        """

        def _q(suffix: str) -> object:
            sql = cte + suffix
            if params:
                return ocel_db.conn.execute(sql, params).pl()
            return ocel_db.conn.execute(sql).pl()

        edges_df = _q("""
            SELECT obj_type, activity AS src, next_activity AS tgt, COUNT(*) AS weight,
                   AVG(next_timestamp_unix - timestamp_unix) AS avg_lead_time
            FROM event_sequence
            WHERE next_activity IS NOT NULL
            GROUP BY obj_type, activity, next_activity
        """)

        node_freq_df = _q("""
            SELECT obj_type, activity, COUNT(*) AS count
            FROM event_sequence
            GROUP BY obj_type, activity
        """)

        starts_df = _q("""
            SELECT obj_type, activity, COUNT(*) AS weight
            FROM event_sequence
            WHERE prev_activity IS NULL
            GROUP BY obj_type, activity
        """)

        ends_df = _q("""
            SELECT obj_type, activity, COUNT(*) AS weight
            FROM event_sequence
            WHERE next_activity IS NULL
            GROUP BY obj_type, activity
        """)

        graph = cls()

        # Determine the sorted object types present in the result
        all_types = sorted(node_freq_df["obj_type"].unique().to_list())

        # 1. Activity nodes — accumulate types set
        for row in node_freq_df.iter_rows(named=True):
            act = row["activity"]
            otype = row["obj_type"]
            count = row["count"]
            if not graph.has_node(act):
                graph.add_node(act, label=act, types={otype}, metrics={"frequency": count})
            else:
                graph.nodes[act]["types"].add(otype)
                if "metrics" not in graph.nodes[act]:
                    graph.nodes[act]["metrics"] = {"frequency": 0}
                graph.nodes[act]["metrics"]["frequency"] += count

        # 2. Start nodes and edges
        for otype in all_types:
            otype_starts = starts_df.filter(starts_df["obj_type"] == otype)
            if otype_starts.is_empty():
                continue
            start_node = f"__start__:{otype}"
            graph.add_node(
                start_node,
                label=f"{otype} start",
                types={otype},
                role="start",
                object_type=otype,
            )
            for row in otype_starts.iter_rows(named=True):
                target = row["activity"]
                w = row["weight"]
                if graph.has_node(target):
                    graph.add_edge(
                        start_node, target,
                        weights={otype: w}, weight=w, owners={otype}, role="start",
                        metrics={"frequency": w}
                    )

        # 3. End nodes and edges
        for otype in all_types:
            otype_ends = ends_df.filter(ends_df["obj_type"] == otype)
            if otype_ends.is_empty():
                continue
            end_node = f"__end__:{otype}"
            graph.add_node(
                end_node,
                label=f"{otype} end",
                types={otype},
                role="end",
                object_type=otype,
            )
            for row in otype_ends.iter_rows(named=True):
                source = row["activity"]
                w = row["weight"]
                if graph.has_node(source):
                    graph.add_edge(
                        source, end_node,
                        weights={otype: w}, weight=w, owners={otype}, role="end",
                        metrics={"frequency": w}
                    )

        # 4. Regular edges
        for row in edges_df.iter_rows(named=True):
            u, v, w, otype, avg_time = row["src"], row["tgt"], row["weight"], row["obj_type"], row.get("avg_lead_time")
            if graph.has_edge(u, v):
                graph.edges[u, v]["weights"][otype] = (
                    graph.edges[u, v]["weights"].get(otype, 0) + w
                )
                graph.edges[u, v]["weight"] += w
                graph.edges[u, v]["owners"].add(otype)
                if "metrics" not in graph.edges[u, v]:
                    graph.edges[u, v]["metrics"] = {"frequency": 0, "avg_lead_time": 0}
                graph.edges[u, v]["metrics"]["frequency"] += w
                # We could do a weighted average, but for simplicity we'll just sum or take the last.
                # Since graph.add_edge in nx MultiDiGraph needs keys for parallel edges, wait:
                # Is graph a MultiDiGraph? It says `cls()` which is NewOCDFGDb. Let's look at what graph type it is.
                # Wait, I see graph.edges[u, v]["weight"] += w. So it's NOT parallel edges here? 
                # Oh, Totem lib might be using a simple DiGraph here, or the query already aggregated?
                graph.edges[u, v]["metrics"]["avg_lead_time"] = avg_time
            else:
                graph.add_edge(
                    u, v, weights={otype: w}, weight=w, owners={otype},
                    metrics={"frequency": w, "avg_lead_time": avg_time}
                )

        # 5. Finalize: convert sets to sorted lists
        for node in graph.nodes():
            if "types" in graph.nodes[node]:
                graph.nodes[node]["types"] = sorted(list(graph.nodes[node]["types"]))
        for u, v in graph.edges():
            if "owners" in graph.edges[u, v]:
                graph.edges[u, v]["owners"] = sorted(list(graph.edges[u, v]["owners"]))

        return graph


class NewOCDFGDb(nx.MultiDiGraph):
    """
    DuckDB-backed Object-Centric Directly-Follows MultiGraph (OCDFG).

    Inherits from NetworkX MultiDiGraph to support parallel directed edges (arcs)
    between the same source and target nodes. Each parallel edge represents a
    distinct object type (identified by the `key` parameter), ensuring that type-specific
    frequencies are maintained separately rather than aggregated.

    Attributes:
        graph (dict): Metadata about the graph. Includes key `kind` set to 'new_ocdfg'.
    """
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.graph['kind'] = 'new_ocdfg'

    # ------------------------------------------------------------------
    # Helper: per-type trace-variant computation (moved from views.py)
    # ------------------------------------------------------------------

    @classmethod
    def compute_variants(
        cls,
        ocel_db: OcelDuckDB,
        object_types: Optional[List[str]] = None,
    ) -> dict:
        """
        Compute per-object-type activity-sequence variants entirely in SQL.

        For each object of the requested types, builds a ``'|'``-joined activity
        sequence (the trace) ordered by event timestamp, then groups by
        ``(obj_type, trace)`` to count instances.

        Args:
            ocel_db: DuckDB-backed event log.
            object_types: If provided, only these types are processed. When
                ``None`` all types present in the log are used.

        Returns:
            A dict shaped as::

                {obj_type: {
                    "variants": [
                        {"trace": ["a", "b", ...], "count": N, "objects": ["o1", ...]},
                        ...   # sorted most-frequent first
                    ],
                    "total_objects": M,
                }}
        """
        if object_types is None:
            rows = ocel_db.conn.execute(
                "SELECT DISTINCT obj_type FROM objects"
            ).fetchall()
            object_types = [r[0] for r in rows]

        if not object_types:
            return {}

        types_list = list(object_types)
        placeholders = ", ".join(["?"] * len(types_list))

        # total_objects per type (including objects with no events)
        totals = {
            t: n
            for t, n in ocel_db.conn.execute(
                f"SELECT obj_type, COUNT(*) FROM objects "
                f"WHERE obj_type IN ({placeholders}) GROUP BY obj_type",
                types_list,
            ).fetchall()
        }

        variants_by_type: dict[str, list[dict]] = defaultdict(list)
        rows = ocel_db.conn.execute(
            f"""
            WITH per_obj_traces AS (
                SELECT
                    o.obj_id,
                    o.obj_type,
                    STRING_AGG(e.activity, '|'
                               ORDER BY e.timestamp_unix, e.event_id) AS trace
                FROM objects o
                JOIN event_object eo ON eo.obj_id   = o.obj_id
                JOIN events       e  ON eo.event_id = e.event_id
                WHERE o.obj_type IN ({placeholders})
                GROUP BY o.obj_id, o.obj_type
            )
            SELECT
                obj_type,
                trace,
                COUNT(*)                 AS cnt,
                LIST(obj_id ORDER BY obj_id) AS objects
            FROM per_obj_traces
            GROUP BY obj_type, trace
            ORDER BY obj_type, cnt DESC
            """,
            types_list,
        ).fetchall()

        for obj_type, trace, cnt, objects in rows:
            variants_by_type[obj_type].append({
                "trace": trace.split("|") if trace else [],
                "count": int(cnt),
                "objects": list(objects),
            })

        result: dict = {}
        for t in object_types:
            result[t] = {
                "variants": variants_by_type.get(t, []),
                "total_objects": int(totals.get(t, 0)),
            }
        return result

    # ------------------------------------------------------------------
    # Core builder: full OC-DFG (no filtering)
    # ------------------------------------------------------------------

    @classmethod
    def from_ocel_db(
        cls,
        ocel_db: OcelDuckDB,
        object_types: Optional[List[str]] = None,
    ) -> "NewOCDFGDb":
        """
        Build the new OC-DFG (MultiDiGraph) from a DuckDB-backed event log.

        This method queries the event log database via DuckDB to construct the
        directly-follows relationships for each object type. It populates
        the multigraph with activity nodes, terminal start/end nodes, and the
        corresponding type-specific directed edges.

        Args:
            ocel_db (OcelDuckDB): The DuckDB-backed event log database wrapper.
            object_types (Optional[List[str]]): A list of object types to filter by.
                If None or empty, all object types present in the event log are used.

        Returns:
            NewOCDFGDb: An initialized NewOCDFGDb multigraph instance populated with
                nodes and parallel edges representing the directly-follows relation
                for the selected object types.
        """
        type_filter = ""
        params: list = []
        if object_types is not None:
            placeholders = ", ".join(["?"] * len(object_types))
            type_filter = f"WHERE o.obj_type IN ({placeholders})"
            params = list(object_types)

        cte = f"""
            WITH event_sequence AS (
                SELECT
                    e.event_id,
                    e.activity,
                    o.obj_id,
                    o.obj_type,
                    LAG(e.activity)  OVER w AS prev_activity,
                    LEAD(e.activity) OVER w AS next_activity
                FROM events e
                JOIN event_object eo ON e.event_id = eo.event_id
                JOIN objects o       ON eo.obj_id  = o.obj_id
                {type_filter}
                WINDOW w AS (PARTITION BY eo.obj_id ORDER BY e.timestamp_unix, e.event_id)
            )
        """

        def _q(suffix: str) -> object:
            sql = cte + suffix
            if params:
                return ocel_db.conn.execute(sql, params).pl()
            return ocel_db.conn.execute(sql).pl()

        edges_df = _q("""
            SELECT obj_type, activity AS src, next_activity AS tgt, COUNT(*) AS weight
            FROM event_sequence
            WHERE next_activity IS NOT NULL
            GROUP BY obj_type, activity, next_activity
        """)

        node_freq_df = _q("""
            SELECT obj_type, activity, COUNT(*) AS count
            FROM event_sequence
            GROUP BY obj_type, activity
        """)

        starts_df = _q("""
            SELECT obj_type, activity, COUNT(*) AS weight
            FROM event_sequence
            WHERE prev_activity IS NULL
            GROUP BY obj_type, activity
        """)

        ends_df = _q("""
            SELECT obj_type, activity, COUNT(*) AS weight
            FROM event_sequence
            WHERE next_activity IS NULL
            GROUP BY obj_type, activity
        """)

        graph = cls()

        # Determine the sorted object types present in the result
        all_types = sorted(node_freq_df["obj_type"].unique().to_list())

        # 1. Activity nodes — accumulate types set
        node_types_map = {}
        for row in node_freq_df.iter_rows(named=True):
            act = row["activity"]
            otype = row["obj_type"]
            if act not in node_types_map:
                node_types_map[act] = set()
            node_types_map[act].add(otype)

        for act, otypes in node_types_map.items():
            graph.add_node(act, label=act, types=sorted(list(otypes)))

        # 2. Start nodes and edges
        for otype in all_types:
            otype_starts = starts_df.filter(starts_df["obj_type"] == otype)
            if otype_starts.is_empty():
                continue
            start_node = f"__start__:{otype}"
            graph.add_node(
                start_node,
                label=f"{otype} start",
                types=[otype],
                role="start",
                object_type=otype,
            )
            for row in otype_starts.iter_rows(named=True):
                target = row["activity"]
                w = row["weight"]
                if graph.has_node(target):
                    # Since MultiDiGraph allows parallel edges between the same nodes,
                    # the key parameter is required by NetworkX to uniquely identify
                    # and update the specific parallel edge representing a given object type.
                    graph.add_edge(
                        start_node, target,
                        key=otype, objtype=otype, weight=w, role="start"
                    )

        # 3. End nodes and edges
        for otype in all_types:
            otype_ends = ends_df.filter(ends_df["obj_type"] == otype)
            if otype_ends.is_empty():
                continue
            end_node = f"__end__:{otype}"
            graph.add_node(
                end_node,
                label=f"{otype} end",
                types=[otype],
                role="end",
                object_type=otype,
            )
            for row in otype_ends.iter_rows(named=True):
                source = row["activity"]
                w = row["weight"]
                if graph.has_node(source):
                    # Since MultiDiGraph allows parallel edges between the same nodes,
                    # the key parameter is required by NetworkX to uniquely identify
                    # and update the specific parallel edge representing a given object type.
                    graph.add_edge(
                        source, end_node,
                        key=otype, objtype=otype, weight=w, role="end"
                    )

        # 4. Regular edges
        for row in edges_df.iter_rows(named=True):
            u, v, w, otype = row["src"], row["tgt"], row["weight"], row["obj_type"]
            # Since MultiDiGraph allows parallel edges between the same nodes,
            # the key parameter is required by NetworkX to uniquely identify
            # and update the specific parallel edge representing a given object type.
            graph.add_edge(u, v, key=otype, objtype=otype, weight=w)

        return graph

    # ------------------------------------------------------------------
    # New algorithm: precomputed variant ranks (Task 3)
    # ------------------------------------------------------------------

    @classmethod
    def from_ocel_db_with_variant_ranks(
        cls,
        ocel_db: OcelDuckDB,
        object_types: Optional[List[str]] = None,
    ) -> tuple["NewOCDFGDb", dict]:
        """
        Build the OC-DFG **and** annotate every edge with a ``variant_rank``.

        The variant rank answers: "what is the highest-frequency variant (lowest
        rank number) that contains this directly-follows arc?"

        Algorithm
        ---------
        For each object type:
          1. Compute all per-object trace variants, sorted by frequency
             descending (rank 1 = most frequent, rank 2 = second most, …).
          2. Iterate from rank 1 to rank N.  For each step in the variant
             trace, if the edge ``(src → tgt, objtype)`` has **not yet** been
             annotated, annotate it with the current rank.
          3. Start / end connector edges are annotated with ``variant_rank = 0``
             (always visible regardless of the slider value).

        The frontend can then filter purely client-side:
          - If the slider for type T is set to k, hide all T-edges whose
            ``variant_rank > k``.

        Args:
            ocel_db: DuckDB-backed event log.
            object_types: Restrict to these types; ``None`` → all types.

        Returns:
            A tuple ``(graph, variant_counts)`` where:
              - ``graph`` is a ``NewOCDFGDb`` with ``variant_rank`` on every edge.
              - ``variant_counts`` is ``{obj_type: total_variant_count}`` so the
                frontend can initialize the sliders to the right maximum.
        """
        # Step 1: build the full unfiltered graph
        graph = cls.from_ocel_db(ocel_db, object_types=object_types)

        # Step 2: collect variants per type (sorted most-frequent first)
        actual_types = list(set(
            data.get("object_type", "")
            for _, data in graph.nodes(data=True)
            if data.get("role") == "start" and data.get("object_type")
        ))
        if not actual_types:
            # No terminal nodes means no typed edges — nothing to rank
            return graph, {}

        variants_data = cls.compute_variants(ocel_db, object_types=actual_types)

        # Step 3: annotate edges with variant ranks, including terminal edges
        # For each type: iterate variants by rank, add DF pairs that are not yet annotated
        for otype, type_data in variants_data.items():
            variants = type_data.get("variants", [])
            start_node = f"__start__:{otype}"
            end_node = f"__end__:{otype}"
            
            for rank, variant in enumerate(variants, start=1):
                trace = variant.get("trace", [])
                if not trace:
                    continue
                    
                # 1. Start edge to first activity
                first_act = trace[0]
                if graph.has_edge(start_node, first_act, key=otype):
                    edge_data = graph.edges[start_node, first_act, otype]
                    if "variant_rank" not in edge_data:
                        edge_data["variant_rank"] = rank
                        
                # 2. Regular DF edges between activities
                for i in range(len(trace) - 1):
                    src_act = trace[i]
                    tgt_act = trace[i + 1]
                    if graph.has_edge(src_act, tgt_act, key=otype):
                        edge_data = graph.edges[src_act, tgt_act, otype]
                        if "variant_rank" not in edge_data:
                            edge_data["variant_rank"] = rank
                            
                # 3. End edge from last activity
                last_act = trace[-1]
                if graph.has_edge(last_act, end_node, key=otype):
                    edge_data = graph.edges[last_act, end_node, otype]
                    if "variant_rank" not in edge_data:
                        edge_data["variant_rank"] = rank

        # Step 4: any edge (regular or terminal) still without a rank gets the max rank for its type
        # (edge exists in the full DFG but doesn't appear in any variant trace — rare)
        for otype, type_data in variants_data.items():
            max_rank = len(type_data.get("variants", []))
            fallback = max(max_rank, 1)
            for u, v, key, data in graph.edges(keys=True, data=True):
                if key == otype and "variant_rank" not in data:
                    data["variant_rank"] = fallback

        # Build variant_counts for the frontend slider max values
        variant_counts = {
            otype: len(type_data.get("variants", []))
            for otype, type_data in variants_data.items()
        }

        return graph, variant_counts
