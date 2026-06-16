import math
from typing import List, Literal

import polars as pl
import networkx as nx
from totem_lib import ObjectCentricEventLog as OCEL
import matplotlib.pyplot as plt

pl.Config.set_tbl_rows(-1)      # to show all rows set this to -1
pl.Config.set_tbl_cols(-1)      # show all columns
pl.Config.set_fmt_str_lengths(None)  # don't truncate strings


class OCHANDOVER(nx.MultiDiGraph):
    """
    
    """
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

    

    @classmethod
    def from_ocel(cls, ocel: OCEL, resource_types: List[str], businessobject_types: List[str], max_gap: int | None = None,
                  normalization: Literal["by_source", "by_target", "by_arcs_in_eog", "by_total_weight"] = "by_arcs_in_eog",
                  normalization_scope: Literal["global", "per_bo_type"] = "global",
                  parallel_threshold: float | None = None,
                  min_parallel_observations: int = 1,
                  cluster_map: dict[str, str] | None = None) -> 'OCHANDOVER':

        """
            Normalization still an issue
            For example when differentiating the different object types, do we divide for each type individually or with the same value
        """

        

        # Get the object ids of the resources and business objects
        
        resource_ids = set()
        for obj_type in resource_types:
            resource_ids.update(ocel.get_object_ids_by_type(obj_type))

        businessobject_ids = set()
        for obj_type in businessobject_types:
            businessobject_ids.update(ocel.get_object_ids_by_type(obj_type))



        event_objects = (
            ocel.events
            .select(["_eventId", "_activity", "_timestampUnix", "_objects"])
            .explode("_objects")
            .rename({"_objects": "_objId"})
        )

        print("Event Objects (Explode)")
        print(event_objects)

        event_resources = (
            event_objects
            .filter(pl.col("_objId").is_in(resource_ids))
            .group_by("_eventId")
            .agg(
                pl.col("_objId").unique().alias("resources")
            )
        )

        print("Event Resources")
        print(event_resources)

        # Replace individual resource IDs with cluster IDs before the algorithm runs.
        # Multiple resources from the same cluster in one event collapse to a single entry.
        # Outliers (resources absent from cluster_map) keep their original ID.
        if cluster_map:
            event_resources = (
                event_resources
                .with_columns(
                    pl.col("resources")
                    .list.eval(pl.element().replace(cluster_map, default=pl.element()))
                    .list.unique()
                )
            )

        # Get the type of the objects by their id

        businessobject_type_by_id = {}

        for obj_type in businessobject_types:
            for obj_id in ocel.get_object_ids_by_type(obj_type):
                businessobject_type_by_id[obj_id] = obj_type

        resource_type_by_id = {}

        for obj_type in resource_types:
            for obj_id in ocel.get_object_ids_by_type(obj_type):
                resource_type_by_id[obj_id] = obj_type

        if cluster_map:
            for cluster_id in set(cluster_map.values()):
                resource_type_by_id[cluster_id] = "cluster"


        businessobject_type_df = pl.DataFrame({
            "businessobject_id": list(businessobject_type_by_id.keys()),
            "businessobject_type": list(businessobject_type_by_id.values()),
        })


        # Get the business object(s) and type to each event

        event_businessobjects = (
            event_objects
            .filter(pl.col("_objId").is_in(businessobject_ids))
            .select([
                "_eventId",
                "_activity",
                "_timestampUnix",
                pl.col("_objId").alias("businessobject_id"),
            ])
            .join(businessobject_type_df, on="businessobject_id", how="left")
        )

        print("Event Businessobjects")
        print(event_businessobjects)


        # Build the Event-Object Graph Arcs

        eog_arcs = (
            event_businessobjects
            .sort(["businessobject_id", "_timestampUnix", "_eventId"])
            .with_columns([
                pl.col("_eventId")
                .shift(-1)
                .over("businessobject_id")
                .alias("next_event_id"),

                pl.col("_activity")
                .shift(-1)
                .over("businessobject_id")
                .alias("next_activity"),

                pl.col("_timestampUnix")
                .shift(-1)
                .over("businessobject_id")
                .alias("next_timestampUnix"),
            ])
            .filter(pl.col("next_event_id").is_not_null())
            .select([
                pl.col("_eventId").alias("source_event"),
                pl.col("next_event_id").alias("target_event"),
                "businessobject_id",
                "businessobject_type"
            ])
        )

        print("Event-Object Graph Arcs")
        print(eog_arcs)


        # Put the EOG Table in a form where each arc occurs only once, by assigning multiple objects at once

        # Important:
        # If two events are directly-follows for several business objects,
        # they still represent one event-object graph arc, but we may want
        # to remember which business objects caused the arc.
        eog_arcs_unique = (
            eog_arcs
            .group_by(["source_event", "target_event"])
            .agg([
                pl.col("businessobject_id").unique().alias("businessobjects"),
                pl.col("businessobject_type").unique().alias("businessobject_types"),
            ])
        )

        print("EOG Arcs Unique")
        print(eog_arcs_unique)


        # Assign a sequential position to every event within each business object's
        # lifecycle so that gaps can be measured as the count of intermediate
        # non-resource EOG nodes between two consecutive resource events.

        eog_with_positions = (
            event_businessobjects
            .select(["_eventId", "_timestampUnix", "businessobject_id", "businessobject_type"])
            .sort(["businessobject_id", "_timestampUnix", "_eventId"])
            .with_row_index("global_idx")
            .with_columns(
                (pl.col("global_idx") - pl.col("global_idx").min().over("businessobject_id")).alias("position")
            )
        )

        print("EOG with positions")
        print(eog_with_positions)
        
        # Resource events annotated with their position in the business object lifecycle
        resource_eog_events = (
            eog_with_positions
            .join(event_resources, on="_eventId", how="inner")
        )

        print("Resource EOG events (with position)")
        print(resource_eog_events)

        # For each resource event find the NEXT resource event in the same business
        # object lifecycle by shifting the scalar _eventId column (safe with .over()),
        # then join back to retrieve the next event's resource list.
        # gap = next_position - current_position - 1
        #     = number of intermediate EOG nodes that carry no selected resource
        # gap = 0 means directly adjacent resource events (equivalent to original behavior)

        consecutive_resource_pairs = (
            resource_eog_events
            .sort(["businessobject_id", "_timestampUnix", "_eventId"])
            .with_columns([
                pl.col("_eventId").shift(-1).over("businessobject_id").alias("next_event_id"),
                pl.col("position").shift(-1).over("businessobject_id").alias("next_position"),
                pl.col("_timestampUnix").shift(-1).over("businessobject_id").alias("next_timestampUnix"),
            ])
            .filter(pl.col("next_event_id").is_not_null())
            .join(
                event_resources.rename({"_eventId": "next_event_id", "resources": "next_resources"}),
                on="next_event_id",
                how="inner",
            )
            .with_columns([
                (pl.col("next_position") - pl.col("position") - 1).alias("gap"),
                (pl.col("next_timestampUnix") - pl.col("_timestampUnix")).alias("time_delta"),
            ])
        )

        print("Consecutive resource pairs (with gap, per business object)")
        print(consecutive_resource_pairs)

        eog_arc_count = eog_arcs_unique.height

        if parallel_threshold is not None:
            footprint = cls.compute_footprint(ocel, businessobject_types)

            print("footprint", footprint)

            # Build a set of parallel activity pairs (both directions) from the footprint.
            parallel_set: set[tuple[str, str, str]] = set()
            for _row in footprint.filter(
                (pl.col("relation") == "||") &
                (pl.col("dependency").abs() <= parallel_threshold) &
                ((pl.col("count_ab") + pl.col("count_ba")) >= min_parallel_observations)
            ).to_dicts():
                _bo_type = _row["businessobject_type"]
                _a, _b = _row["activity_a"], _row["activity_b"]
                parallel_set.add((_bo_type, _a, _b))
                parallel_set.add((_bo_type, _b, _a))

            print("parallel pairs", parallel_set)

            # Build per-BO ordered event sequences.
            _bo_seqs: dict = {}
            for _row in (
                event_businessobjects
                .sort(["businessobject_id", "_timestampUnix", "_eventId"])
                .to_dicts()
            ):
                _bo_id = _row["businessobject_id"]
                if _bo_id not in _bo_seqs:
                    _bo_seqs[_bo_id] = {"type": _row["businessobject_type"], "events": []}
                _bo_seqs[_bo_id]["events"].append((_row["_eventId"], _row["_activity"]))

            # Modify EOG arcs to correctly represent parallelism:
            #
            # For each consecutive pair (u, v) in a BO's lifecycle:
            #   - Sequential pair: keep the arc u→v as-is.
            #   - Parallel pair (footprint "||"): remove u→v and add two repair arcs:
            #       Dead-end repair: u → first event after u with a sequential relation to u.
            #       Orphan repair:   last event before v with a sequential relation to v → v.
            #
            # This replaces the flat block abstraction and correctly handles sequential
            # sub-chains inside parallel branches, e.g. A→{B || (C→D)}→E.
            _new_arcs: list[dict] = []
            for _bo_id, _bo_data in _bo_seqs.items():
                _bo_type = _bo_data["type"]
                _events = _bo_data["events"]
                _n = len(_events)

                for _i in range(_n - 1):
                    _eid_i, _act_i = _events[_i]
                    _eid_next, _act_next = _events[_i + 1]

                    if (_bo_type, _act_i, _act_next) not in parallel_set:
                        # Sequential arc: keep.
                        _new_arcs.append({
                            "source_event": _eid_i,
                            "target_event": _eid_next,
                            "businessobject_id": _bo_id,
                            "businessobject_type": _bo_type,
                        })
                    else:
                        # Dead-end repair: connect _eid_i to its first sequential successor.
                        for _j in range(_i + 1, _n):
                            _eid_j, _act_j = _events[_j]
                            if (_bo_type, _act_i, _act_j) not in parallel_set:
                                _new_arcs.append({
                                    "source_event": _eid_i,
                                    "target_event": _eid_j,
                                    "businessobject_id": _bo_id,
                                    "businessobject_type": _bo_type,
                                })
                                break

                        # Orphan repair: connect the last sequential predecessor to _eid_next.
                        for _j in range(_i, -1, -1):
                            _eid_j, _act_j = _events[_j]
                            if (_bo_type, _act_j, _act_next) not in parallel_set:
                                _new_arcs.append({
                                    "source_event": _eid_j,
                                    "target_event": _eid_next,
                                    "businessobject_id": _bo_id,
                                    "businessobject_type": _bo_type,
                                })
                                break

            if _new_arcs:
                modified_eog_arcs = (
                    pl.DataFrame(_new_arcs)
                    .unique(subset=["source_event", "target_event", "businessobject_id"])
                )
            else:
                modified_eog_arcs = pl.DataFrame(schema={
                    "source_event": pl.Utf8,
                    "target_event": pl.Utf8,
                    "businessobject_id": pl.Utf8,
                    "businessobject_type": pl.Utf8,
                })

            print("Modified EOG arcs")
            print(modified_eog_arcs)

            # Update eog_arcs and derived counts for downstream normalisation.
            eog_arcs = modified_eog_arcs
            eog_arcs_unique = (
                modified_eog_arcs
                .group_by(["source_event", "target_event"])
                .agg([
                    pl.col("businessobject_id").unique().alias("businessobjects"),
                    pl.col("businessobject_type").unique().alias("businessobject_types"),
                ])
            )
            eog_arc_count = eog_arcs_unique.height

            # Per-event timestamps for time_delta computation.
            _event_ts = (
                event_businessobjects
                .select(["_eventId", "_timestampUnix"])
                .unique("_eventId")
            )

            # For each modified arc, cross-join source and target resource lists.
            # The split node A→B and A→C naturally yields R(A)→R(B) and R(A)→R(C)
            # without merging parallel branches into a single block.
            _raw_handovers = (
                modified_eog_arcs
                .join(event_resources, left_on="source_event", right_on="_eventId", how="inner")
                .rename({"resources": "source_resources"})
                .join(event_resources, left_on="target_event", right_on="_eventId", how="inner")
                .rename({"resources": "target_resources"})
                .join(_event_ts, left_on="source_event", right_on="_eventId", how="left")
                .rename({"_timestampUnix": "source_ts"})
                .join(_event_ts, left_on="target_event", right_on="_eventId", how="left")
                .rename({"_timestampUnix": "target_ts"})
                .with_columns((pl.col("target_ts") - pl.col("source_ts")).alias("time_delta"))
                .explode("source_resources")
                .explode("target_resources")
                .select(["source_resources", "target_resources", "businessobject_type", "time_delta"])
                .rename({"source_resources": "source", "target_resources": "target"})
            )

            print("Raw handovers (parallel-aware EOG)")
            print(_raw_handovers.sort(["source", "target"]))

            handover_edges = (
                _raw_handovers
                .group_by(["source", "target", "businessobject_type"])
                .agg([
                    pl.len().alias("weight"),
                    pl.col("time_delta").mean().alias("avg_time"),
                    pl.col("time_delta").min().alias("min_time"),
                    pl.col("time_delta").max().alias("max_time"),
                ])
                .sort("weight", descending=True)
            )

        else:
            # Original approach: consecutive adjacent resource pairs in the EOG.
            arcs_with_resources = (
                consecutive_resource_pairs
                .group_by(["_eventId", "next_event_id"])
                .agg([
                    pl.col("resources").first().alias("source_resources"),
                    pl.col("next_resources").first().alias("target_resources"),
                    pl.col("businessobject_type").unique().alias("businessobject_types"),
                    pl.col("gap").min().alias("gap"),
                    pl.col("time_delta").first().alias("time_delta"),
                ])
            )

            print("Arcs with Resources (unique, with gap)")
            print(arcs_with_resources)

            if max_gap is not None:
                arcs_with_resources = arcs_with_resources.filter(pl.col("gap") <= max_gap)

            handover_edges = (
                arcs_with_resources
                .explode("source_resources")
                .explode("target_resources")
                .explode("businessobject_types")
                .group_by(["source_resources", "target_resources", "businessobject_types"])
                .agg([
                    pl.len().alias("weight"),
                    pl.col("time_delta").mean().alias("avg_time"),
                    pl.col("time_delta").min().alias("min_time"),
                    pl.col("time_delta").max().alias("max_time"),
                ])
                .rename({
                    "source_resources": "source",
                    "target_resources": "target",
                    "businessobject_types": "businessobject_type",
                })
                .sort("weight", descending=True)
            )

        print("Handover edges")
        print(handover_edges)

        # Compute normalised weight according to the chosen strategy and scope.
        # global: denominator is computed across all business object types together.
        # per_bo_type: denominator is computed separately for each business object type,
        #              so high-traffic types no longer dominate low-traffic ones visually.
        if normalization == "by_source":
            group_cols = ["source", "businessobject_type"] if normalization_scope == "per_bo_type" else ["source"]
            source_totals = handover_edges.group_by(group_cols).agg(pl.col("weight").sum().alias("_source_total"))
            handover_edges = (
                handover_edges
                .join(source_totals, on=group_cols, how="left")
                .with_columns((pl.col("weight") / pl.col("_source_total")).alias("norm_weight"))
                .drop("_source_total")
            )

        elif normalization == "by_target":
            group_cols = ["target", "businessobject_type"] if normalization_scope == "per_bo_type" else ["target"]
            target_totals = handover_edges.group_by(group_cols).agg(pl.col("weight").sum().alias("_target_total"))
            handover_edges = (
                handover_edges
                .join(target_totals, on=group_cols, how="left")
                .with_columns((pl.col("weight") / pl.col("_target_total")).alias("norm_weight"))
                .drop("_target_total")
            )

        elif normalization == "by_arcs_in_eog":
            if normalization_scope == "per_bo_type":
                # Count unique EOG arcs per business object type
                bo_arc_counts = (
                    eog_arcs
                    .select(["source_event", "target_event", "businessobject_type"])
                    .unique()
                    .group_by("businessobject_type")
                    .len()
                    .rename({"len": "_arc_count"})
                )
                print("bo arc counts", bo_arc_counts)
                handover_edges = (
                    handover_edges
                    .join(bo_arc_counts, on="businessobject_type", how="left")
                    .with_columns((pl.col("weight") / pl.col("_arc_count")).alias("norm_weight"))
                    .drop("_arc_count")
                )
            else:
                handover_edges = handover_edges.with_columns(
                    (pl.col("weight") / eog_arc_count).alias("norm_weight")
                )

        elif normalization == "by_total_weight":
            if normalization_scope == "per_bo_type":
                bo_totals = handover_edges.group_by("businessobject_type").agg(pl.col("weight").sum().alias("_bo_total"))
                handover_edges = (
                    handover_edges
                    .join(bo_totals, on="businessobject_type", how="left")
                    .with_columns((pl.col("weight") / pl.col("_bo_total")).alias("norm_weight"))
                    .drop("_bo_total")
                )
            else:
                total = handover_edges.select(pl.col("weight").sum()).item()
                handover_edges = handover_edges.with_columns(
                    (pl.col("weight") / total).alias("norm_weight")
                )

        print("norm_weight sum", handover_edges.select(pl.col("norm_weight").sum()).item())


        graph = cls()

        for row in handover_edges.to_dicts():
            source = row["source"]
            target = row["target"]
            bo_type = row["businessobject_type"]

            graph.add_node(
                source,
                object_type=resource_type_by_id.get(source, "unknown"),
            )

            graph.add_node(
                target,
                object_type=resource_type_by_id.get(target, "unknown"),
            )

            graph.add_edge(
                source,
                target,
                key=bo_type,
                weight=row["norm_weight"],
                raw_weight=row["weight"],
                businessobject_type=bo_type,
                avg_time=row.get("avg_time"),
                min_time=row.get("min_time"),
                max_time=row.get("max_time"),
            )

        return graph
    


    @classmethod
    def from_ocel_flattened(cls, ocel: OCEL, case_type: str, resource_type: str, max_gap: int | None = None) -> 'OCHANDOVER':

        """
            Huge uncertainty:
            When grouping for the case ids, we get only the events, where an object of the resource type was involved.
            This makes it seem like there was nothing in between.
            The issue here is that if we only look at one object type in the flattened version, the way we do here, we do not detect those gaps.
            The result is that if there is a resource o1 from our resource object type, and then some activities from other object types followed by an activity of o1,
            which is another resource, this is counted as a handover from o1 to o2. However this would have to be seen as a handover from o1 to the objects in between and then to o2?

            max_gap: if set, only handovers where the number of intervening case events
            (events that belong to the case but have no resource) is <= max_gap are kept.
            Gap 0 means the two resource events are directly adjacent in the case trace.
        """

        case_ids = set(ocel.get_object_ids_by_type(case_type))
        resource_ids = set(ocel.get_object_ids_by_type(resource_type))

        event_objects = (
            ocel.events
            .select(["_eventId", "_activity", "_timestampUnix", "_objects"])
            .explode("_objects")
            .rename({"_objects": "_objId"})
        )

        print("OCEL Table")
        print(ocel.events.select(["_eventId", "_activity", "_timestampUnix", "_objects"]).head(10))

        print("Events (Explode)")
        print(event_objects.head(10))

        case_df = (
            event_objects
            .filter(pl.col("_objId").is_in(case_ids))
            .select([
                "_eventId",
                pl.col("_objId").alias("case_id"),
            ])
        )

        print("Cases")
        print(case_df.head(10))

        resource_df = (
            event_objects
            .filter(pl.col("_objId").is_in(resource_ids))
            .select([
                "_eventId",
                pl.col("_objId").alias("resource_id"),
            ])
        )

        print("Resources")
        print(resource_df)

        # All events that belong to a case (including those without a resource),
        # assigned a sequential position within each case so we can measure
        # how many non-resource events sit between two consecutive resource events.
        all_case_events = (
            ocel.events
            .select(["_eventId", "_timestampUnix"])
            .join(case_df, on="_eventId", how="inner")
            .sort(["case_id", "_timestampUnix", "_eventId"])
            .with_row_index("global_idx")
            .with_columns(
                (pl.col("global_idx") - pl.col("global_idx").min().over("case_id")).alias("position")
            )
        )

        print("All case events (with position)")
        print(all_case_events.head(20))

        # Resource events with their within-case position
        resource_case_events = (
            all_case_events
            .join(resource_df, on="_eventId", how="inner")
        )

        print("Resource case events")
        print(resource_case_events)

        # Detect handover: consecutive resource events within each case.
        # gap = number of intervening case events (position difference minus 1).
        handovers_raw = (
            resource_case_events
            .sort(["case_id", "_timestampUnix", "_eventId"])
            .with_columns([
                pl.col("resource_id").shift(-1).over("case_id").alias("next_resource_id"),
                pl.col("position").shift(-1).over("case_id").alias("next_position"),
            ])
            .filter(pl.col("next_resource_id").is_not_null())
            .with_columns(
                (pl.col("next_position") - pl.col("position") - 1).alias("gap")
            )
        )

        print("Handovers raw (with gap)")
        print(handovers_raw)

        # Apply gap filter when requested
        if max_gap is not None:
            handovers_raw = handovers_raw.filter(pl.col("gap") <= max_gap)

        handover_edges = (
            handovers_raw
            .group_by(["resource_id", "next_resource_id"])
            .len()
            .rename({
                "resource_id": "source",
                "next_resource_id": "target",
                "len": "weight",
            })
            .sort("weight", descending=True)
        )

        # total = handover_edges.select(pl.col("weight").sum()).item()
        total = case_df.select(pl.col("case_id").n_unique()).item()

        handover_edges = handover_edges.with_columns(
            (pl.col("weight") / total).alias("norm_weight")
        )


        max_value = handover_edges.select(pl.col("weight").max()).item()

        print("Handover edges")
        print(handover_edges)


        graph = cls()
        
        for row in handover_edges.to_dicts():
            source = row["source"]
            target = row["target"]
            weight = row["norm_weight"]

            graph.add_node(
                source,
                object_type=resource_type,
            )

            graph.add_node(
                target,
                object_type=resource_type,
            )

            graph.add_edge(
                source,
                target,
                weight=weight,
                raw_weight=row["weight"],
                businessobject_type=case_type,
            )

        return graph

    def plot(self):
        import matplotlib.patches as mpatches

        def separate_overlapping_nodes(pos, min_distance=0.08):
            import math

            nodes = list(pos.keys())

            for i, node_a in enumerate(nodes):
                for node_b in nodes[i + 1:]:
                    xa, ya = pos[node_a]
                    xb, yb = pos[node_b]

                    dx = xb - xa
                    dy = yb - ya
                    distance = math.sqrt(dx * dx + dy * dy)

                    if distance < min_distance:
                        if distance == 0:
                            dx, dy = 0.01, 0.01
                            distance = math.sqrt(dx * dx + dy * dy)

                        push = (min_distance - distance) / 2
                        ux = dx / distance
                        uy = dy / distance

                        pos[node_a][0] -= ux * push
                        pos[node_a][1] -= uy * push
                        pos[node_b][0] += ux * push
                        pos[node_b][1] += uy * push

            return pos

        pos = nx.spring_layout(
            self,
            k=1.5,
            iterations=200,
            seed=42,
        )


        edge_data = list(self.edges(data=True))
        node_data = list(self.nodes(data=True))

        # -------------------------
        # Edge weights
        # -------------------------
        weights = [
            d.get("weight", 0)
            for _, _, d in edge_data
        ]

        min_weight = min(weights) if weights else 0
        max_weight = max(weights) if weights else 1

        def scale_width(weight, min_width=1.0, max_width=6.0):
            if max_weight == min_weight:
                return (min_width + max_width) / 2

            return min_width + (
                (weight - min_weight) / (max_weight - min_weight)
            ) * (max_width - min_width)

        edge_widths = [
            scale_width(d.get("weight", 0))
            for _, _, d in edge_data
        ]

        # -------------------------
        # Edge colors by business-object type
        # -------------------------
        edge_bo_types = [
            d.get("businessobject_type", "unknown")
            for _, _, d in edge_data
        ]

        unique_edge_types = sorted(set(edge_bo_types))

        edge_cmap = plt.get_cmap("tab10")

        edge_type_to_color = {
            bo_type: edge_cmap(i % edge_cmap.N)
            for i, bo_type in enumerate(unique_edge_types)
        }

        edge_colors = [
            edge_type_to_color[d.get("businessobject_type", "unknown")]
            for _, _, d in edge_data
        ]

        # -------------------------
        # Node colors by resource object type
        # -------------------------
        node_object_types = [
            d.get("object_type", "unknown")
            for _, d in node_data
        ]

        unique_node_types = sorted(set(node_object_types))

        node_cmap = plt.get_cmap("Set2")

        node_type_to_color = {
            obj_type: node_cmap(i % node_cmap.N)
            for i, obj_type in enumerate(unique_node_types)
        }

        node_colors = [
            node_type_to_color[d.get("object_type", "unknown")]
            for _, d in node_data
        ]

        plt.figure(figsize=(10, 8))

        nx.draw_networkx_nodes(
            self,
            pos,
            nodelist=[n for n, _ in node_data],
            node_size=1500,
            node_color=node_colors,
            edgecolors="black",
        )

        nx.draw_networkx_labels(
            self,
            pos,
            font_size=10,
        )

        
        nx.draw_networkx_edges(
            self,
            pos,
            edgelist=[(u, v) for u, v, _ in edge_data],
            edge_color=edge_colors,
            arrows=True,
            arrowsize=20,
            width=edge_widths,
            connectionstyle="arc3,rad=0.2",
            min_source_margin=20,
            min_target_margin=20,
        )

        # -------------------------
        # Legends
        # -------------------------
        node_legend_handles = [
            mpatches.Patch(
                color=node_type_to_color[obj_type],
                label=obj_type,
            )
            for obj_type in unique_node_types
        ]

        edge_legend_handles = [
            mpatches.Patch(
                color=edge_type_to_color[bo_type],
                label=bo_type,
            )
            for bo_type in unique_edge_types
        ]

        node_legend = plt.legend(
            handles=node_legend_handles,
            title="Resource",
            loc="upper left",
        )

        plt.gca().add_artist(node_legend)

        plt.legend(
            handles=edge_legend_handles,
            title="Handover object type",
            loc="upper right",
        )

        plt.axis("off")
        plt.tight_layout()
        plt.show()


    @classmethod
    def compute_footprint(
        cls,
        ocel: OCEL,
        object_types: List[str],
    ) -> pl.DataFrame:
        """
        Compute a per-object-type footprint matrix over activities using each
        object type's lifecycles as traces independently.

        For each ordered pair (A, B) within a given object type the relation is:
          →   A directly precedes B but B does not directly precede A
          ←   B directly precedes A but A does not directly precede B
          ||  both A→B and B→A appear (likely parallel / concurrent)
          #   neither direction appears

        Returns a long-format DataFrame with columns:
          businessobject_type, activity_a, activity_b,
          relation, count_ab, count_ba, dependency

        dependency = (count_ab - count_ba) / (count_ab + count_ba + 1)
        Values near 0 are the strongest candidates for parallelism.
        """
        event_objects_all = (
            ocel.events
            .select(["_eventId", "_activity", "_timestampUnix", "_objects"])
            .explode("_objects")
            .rename({"_objects": "_objId"})
        )

        all_rows = []

        for obj_type in object_types:
            object_ids = set(ocel.get_object_ids_by_type(obj_type))

            event_objects = event_objects_all.filter(pl.col("_objId").is_in(object_ids))

            # Directly-follows pairs within each object's lifecycle
            df_pairs = (
                event_objects
                .sort(["_objId", "_timestampUnix", "_eventId"])
                .with_columns(
                    pl.col("_activity").shift(-1).over("_objId").alias("next_activity")
                )
                .filter(pl.col("next_activity").is_not_null())
                .select([
                    pl.col("_activity").alias("source_activity"),
                    pl.col("next_activity").alias("target_activity"),
                ])
            )

            df_counts = (
                df_pairs
                .group_by(["source_activity", "target_activity"])
                .len()
                .rename({"len": "count"})
            )

            counts_dict: dict[tuple[str, str], int] = {
                (row["source_activity"], row["target_activity"]): row["count"]
                for row in df_counts.to_dicts()
            }

            activities = sorted(
                event_objects.select("_activity").unique().to_series().to_list()
            )

            for a in activities:
                for b in activities:
                    if a == b:
                        # Self-succession tells us an activity repeats, not whether
                        # two distinct activities are concurrent — irrelevant for
                        # parallel handover filtering.
                        continue
                    count_ab = counts_dict.get((a, b), 0)
                    count_ba = counts_dict.get((b, a), 0)
                    if count_ab > 0 and count_ba > 0:
                        relation = "||"
                    elif count_ab > 0:
                        relation = "→"
                    elif count_ba > 0:
                        relation = "←"
                    else:
                        relation = "#"
                    dependency = (count_ab - count_ba) / (count_ab + count_ba + 1)
                    all_rows.append({
                        "businessobject_type": obj_type,
                        "activity_a": a,
                        "activity_b": b,
                        "relation": relation,
                        "count_ab": count_ab,
                        "count_ba": count_ba,
                        "dependency": round(dependency, 4),
                    })

        return pl.DataFrame(all_rows)