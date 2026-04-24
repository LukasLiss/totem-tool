from typing import List, Optional

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
        for row in node_freq_df.iter_rows(named=True):
            act = row["activity"]
            otype = row["obj_type"]
            if not graph.has_node(act):
                graph.add_node(act, label=act, types={otype})
            else:
                graph.nodes[act]["types"].add(otype)

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
                    )

        # 4. Regular edges
        for row in edges_df.iter_rows(named=True):
            u, v, w, otype = row["src"], row["tgt"], row["weight"], row["obj_type"]
            if graph.has_edge(u, v):
                graph.edges[u, v]["weights"][otype] = (
                    graph.edges[u, v]["weights"].get(otype, 0) + w
                )
                graph.edges[u, v]["weight"] += w
                graph.edges[u, v]["owners"].add(otype)
            else:
                graph.add_edge(u, v, weights={otype: w}, weight=w, owners={otype})

        # 5. Finalize: convert sets to sorted lists
        for node in graph.nodes():
            if "types" in graph.nodes[node]:
                graph.nodes[node]["types"] = sorted(list(graph.nodes[node]["types"]))
        for u, v in graph.edges():
            if "owners" in graph.edges[u, v]:
                graph.edges[u, v]["owners"] = sorted(list(graph.edges[u, v]["owners"]))

        return graph
