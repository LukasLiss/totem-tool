import polars as pl
import networkx as nx
from totem_lib import ObjectCentricEventLog as OCEL 

class CCDFG(nx.DiGraph):
    """
    Represents a Case-Centric Directly-Follows Graph for a single object type.
    Nodes are activities, and edges represent the directly-follows relation,
    weighted by frequency.
    """
    def __init__(self, obj_type: str, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.object_type = obj_type

    @classmethod
    def from_ocel(cls, ocel: OCEL, object_type: str, base_df: pl.DataFrame) -> 'CCDFG':
        """Factory method to build a CCDFG for a specific object type from an OCEL."""
        
        # 1. Get relevant object IDs using the new helper method
        obj_ids = ocel.get_object_ids_by_type(object_type)
        if not obj_ids:
            return cls(obj_type=object_type) # Return an empty graph

        per_type_df = base_df.filter(pl.col("_objId").is_in(obj_ids))
        if per_type_df.is_empty():
            return cls(obj_type=object_type)

        # 2. Compute directly-follows pairs and their weights
        sequence = per_type_df.with_columns([
            pl.col("_activity").shift(1).over("_objId").alias("_prev"),
            pl.col("_activity").shift(-1).over("_objId").alias("_next"),
        ])

        pairs = (
            sequence
            .filter(pl.col("_next").is_not_null())
            .group_by(["_activity", "_next"])
            .agg(pl.len().alias("weight"))
        )

        # 3. Compute activity frequencies for node weights
        act_freq = sequence.group_by("_activity").agg(pl.len().alias("count"))

        # 4. Compute start and end activity frequencies
        starts = (
            sequence
            .filter(pl.col("_prev").is_null())
            .group_by("_activity")
            .agg(pl.len().alias("weight"))
        )
        ends = (
            sequence
            .filter(pl.col("_next").is_null())
            .group_by("_activity")
            .agg(pl.len().alias("weight"))
        )
        
        # 5. Build the graph
        graph = cls(obj_type=object_type)
        for row in act_freq.iter_rows(named=True):
            graph.add_node(row["_activity"], label=row["_activity"], count=row["count"])

        for row in pairs.iter_rows(named=True):
            graph.add_edge(row["_activity"], row["_next"], weight=row["weight"])

        # Add explicit start and end marker nodes and edges when available
        if not starts.is_empty():
            start_node_id = f"__start__:{object_type}"
            graph.add_node(
                start_node_id,
                label=f"{object_type} start",
                types={object_type},
                role="start",
                object_type=object_type,
            )
            for row in starts.iter_rows(named=True):
                target = row["_activity"]
                if graph.has_node(target):
                    graph.add_edge(
                        start_node_id,
                        target,
                        weight=row["weight"],
                        role="start",
                    )

        if not ends.is_empty():
            end_node_id = f"__end__:{object_type}"
            graph.add_node(
                end_node_id,
                label=f"{object_type} end",
                types={object_type},
                role="end",
                object_type=object_type,
            )
            for row in ends.iter_rows(named=True):
                source = row["_activity"]
                if graph.has_node(source):
                    graph.add_edge(
                        source,
                        end_node_id,
                        weight=row["weight"],
                        role="end",
                    )

        return graph
