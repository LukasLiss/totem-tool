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
                  cluster_map: dict[str, str] | None = None,
                  cluster_by_ot: bool = False,
                  include_flows: bool = False,
                  include_bindings: bool = False) -> 'OCHANDOVER':

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

        # When cluster_by_ot is set, auto-generate a cluster_map that collapses
        # every resource object to its object type name (e.g. "Mike" → "employee").
        if cluster_by_ot:
            cluster_map = {
                obj_id: obj_type
                for obj_type in resource_types
                for obj_id in ocel.get_object_ids_by_type(obj_type)
            }

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

        # Count distinct events per resource (after cluster mapping, so cluster IDs are counted correctly)
        event_count_by_resource = (
            event_resources
            .explode("resources")
            .group_by("resources")
            .len()
            .rename({"resources": "resource_id", "len": "event_count"})
        )
        event_count_dict: dict[str, int] = {
            row["resource_id"]: row["event_count"]
            for row in event_count_by_resource.to_dicts()
        }

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
            if cluster_by_ot:
                # Cluster IDs are the type names themselves, so they keep their type.
                for obj_type in resource_types:
                    resource_type_by_id[obj_type] = obj_type
            else:
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
                            "_orphan": False,
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
                                    "_orphan": False,
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
                                    "_orphan": True,
                                })
                                break

            # Remove dominated orphan arcs (Definition 4.6 refinement):
            # an orphan repair arc (src, tgt) is dominated if every resource at tgt
            # is already covered by a non-orphan arc from the same src event.
            _event_res: dict[str, frozenset] = {
                r["_eventId"]: frozenset(r["resources"])
                for r in event_resources.to_dicts()
            }
            _src_covered: dict[str, set] = {}
            _non_orphan_pairs: set[tuple[str, str]] = set()
            for _arc in _new_arcs:
                if not _arc["_orphan"]:
                    _s, _t = _arc["source_event"], _arc["target_event"]
                    _non_orphan_pairs.add((_s, _t))
                    _src_covered.setdefault(_s, set()).update(_event_res.get(_t, frozenset()))

            _new_arcs = [
                _arc for _arc in _new_arcs
                if not _arc["_orphan"]
                or (_arc["source_event"], _arc["target_event"]) in _non_orphan_pairs
                or not _event_res.get(_arc["target_event"], frozenset()).issubset(
                    _src_covered.get(_arc["source_event"], set())
                )
            ]

            if _new_arcs:
                modified_eog_arcs = (
                    pl.DataFrame(_new_arcs)
                    .drop("_orphan")
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

        # Per-event timestamps shared by both branches.
        _event_ts = (
            event_businessobjects
            .select(["_eventId", "_timestampUnix"])
            .unique("_eventId")
        )

        # Unified handover computation for both the parallel and non-parallel cases.
        # BFS over the (possibly modified) EOG finds consecutive resource-event pairs,
        # counting non-resource intermediate events as gap and respecting max_gap.
        _raw_handovers = cls._resource_pairs_from_eog(
            eog_arcs, event_resources, _event_ts, max_gap
        )

        # Capture individual flows before aggregation when requested.
        # Timestamps are converted from raw unix values to seconds if they look like ms.
        _animation_flows: dict | None = None
        if include_flows and not _raw_handovers.is_empty():
            _flows_list = _raw_handovers.to_dicts()
            _ts_sample = _flows_list[0]["start_unix"]
            _ts_div = 1000.0 if abs(_ts_sample) > 1e10 else 1.0
            _flows_serialised = [
                {
                    "source": f["source"],
                    "target": f["target"],
                    "bo_type": f["businessobject_type"],
                    "bo_ids": f["businessobject_ids"],
                    "start_time": f["start_unix"] / _ts_div,
                    "duration": max(f["time_delta"] / _ts_div, 1.0),
                }
                for f in _flows_list
            ]
            _ts_starts = [f["start_time"] for f in _flows_serialised]
            _ts_ends = [f["start_time"] + f["duration"] for f in _flows_serialised]
            _animation_flows = {
                "flows": _flows_serialised,
                "timeline": {"start": min(_ts_starts), "end": max(_ts_ends)},
            }

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
                event_count=event_count_dict.get(source, 0),
            )

            graph.add_node(
                target,
                object_type=resource_type_by_id.get(target, "unknown"),
                event_count=event_count_dict.get(target, 0),
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

        if _animation_flows is not None:
            graph.graph["animation_flows"] = _animation_flows

        if include_bindings:
            _ev_res_dict: dict[str, list[str]] = {
                r["_eventId"]: r["resources"] for r in event_resources.to_dicts()
            }
            _ev_ts_dict: dict[str, int] = {
                r["_eventId"]: r["_timestampUnix"] for r in _event_ts.to_dicts()
            }
            graph.graph["bindings"] = cls._compute_bindings(
                eog_arcs, _ev_res_dict, max_gap, _ev_ts_dict
            )

        return graph

    @classmethod
    def _compute_bindings(
        cls,
        eog_arcs: pl.DataFrame,
        event_resources_dict: dict[str, list[str]],
        max_gap: int | None = None,
        event_ts_dict: dict[str, int] | None = None,
    ) -> list[dict]:
        """
        Compute C-net style same-object binding annotations per resource.

        A binding occurs when the same bo_id flows from one source event to 2+
        distinct target resources simultaneously (one BFS per source event per bo_id).
        Returns a flat list of binding dicts for frontend overlay rendering.

        Each dict: {type, resource, arcs: [{other_resource, bo_type, mark, is_gapped}],
                    line_type, count}
        mark = "dot" (single object) | "square" (multiple objects on that arc at that event).
        line_type = "solid" | "dotted" | None (solo).
        is_gapped = True if any occurrence had intermediate non-resource events.
        """
        from collections import defaultdict

        resource_event_set = set(event_resources_dict.keys())
        bo_type_map, canonical = cls._bfs_bridges(
            eog_arcs, resource_event_set, event_resources_dict,
            event_ts_dict or {}, max_gap,
        )

        # Expand canonical bridges into per-(src_event, bid) output maps.
        src_obj_out: dict[tuple, dict[str, bool]] = defaultdict(dict)
        tgt_obj_in:  dict[tuple, dict[str, bool]] = defaultdict(dict)
        for (src_ev, tgt_ev, bid), gap in canonical.items():
            is_gapped = gap > 0
            for tgt_res in event_resources_dict.get(tgt_ev, []):
                prev = src_obj_out[(src_ev, bid)].get(tgt_res)
                if prev is None or (prev and not is_gapped):
                    src_obj_out[(src_ev, bid)][tgt_res] = is_gapped
            for src_res in event_resources_dict.get(src_ev, []):
                prev = tgt_obj_in[(tgt_ev, bid)].get(src_res)
                if prev is None or (prev and not is_gapped):
                    tgt_obj_in[(tgt_ev, bid)][src_res] = is_gapped

        # arc_total_out[(src_event, bo_type, tgt_res)] = set of bo_ids crossing this arc at this event
        # Used to determine dot (1 object) vs square (multiple objects).
        arc_total_out: dict[tuple, set] = defaultdict(set)
        for (src_ev, bid), tgt_map in src_obj_out.items():
            bt = bo_type_map[bid]
            for tgt_res in tgt_map:
                arc_total_out[(src_ev, bt, tgt_res)].add(bid)

        arc_total_in: dict[tuple, set] = defaultdict(set)
        for (tgt_ev, bid), src_map in tgt_obj_in.items():
            bt = bo_type_map[bid]
            for src_res in src_map:
                arc_total_in[(tgt_ev, bt, src_res)].add(bid)

        result: list[dict] = []

        def _line_type(arc_bo_sets: list[set]) -> str:
            """solid if total bo_id sets form a chain of subsets; dotted if cross-cutting."""
            intersection = arc_bo_sets[0].copy()
            for s in arc_bo_sets[1:]:
                intersection &= s
            min_set = min(arc_bo_sets, key=len)
            return "solid" if intersection == min_set else "dotted"

        def _build(obj_map: dict, direction: str) -> None:
            # Build per-(event, type, source-res) arc traffic sets.
            # event_arc_sets: (event, bt, res) → {other_res: {bid: is_gapped}}
            event_arc_sets: dict[tuple, dict[str, dict]] = {}

            for (event, bid), other_map in obj_map.items():
                if not other_map:
                    continue
                bt = bo_type_map[bid]
                for res in event_resources_dict.get(event, []):
                    key = (event, bt, res)
                    if key not in event_arc_sets:
                        event_arc_sets[key] = {}
                    arc_dict = event_arc_sets[key]
                    for other_res, is_gapped in other_map.items():
                        if other_res not in arc_dict:
                            arc_dict[other_res] = {}
                        prev = arc_dict[other_res].get(bid)
                        # False (direct) overrides True (gapped)
                        if prev is None or (prev and not is_gapped):
                            arc_dict[other_res][bid] = is_gapped

            # For each (event, bt, res), group arcs into binding groups via
            # union-find on arc traffic set intersections.  Arcs whose object
            # sets have non-empty intersection get connected.  A group of 2+
            # arcs becomes a binding entry; a singleton becomes a solo entry.
            # Mark: dot if |S|=1, square if |S|>1.  Line: solid if intersection
            # equals the minimum set (subset chain), dotted for partial overlap.
            binding_agg: dict[tuple, dict] = {}   # (res, frozenset_others, bt)
            solo_agg:    dict[tuple, dict] = {}    # (res, other_res, bt)

            for (event, bt, res), arc_dict in event_arc_sets.items():
                others = list(arc_dict.keys())
                n = len(others)
                if n == 0:
                    continue

                bid_sets = [set(arc_dict[or_].keys()) for or_ in others]

                # Union-Find
                parent = list(range(n))

                def _find(x: int, _p: list = parent) -> int:
                    while _p[x] != x:
                        _p[x] = _p[_p[x]]
                        x = _p[x]
                    return x

                def _unite(x: int, y: int) -> None:
                    parent[_find(x)] = _find(y)

                for i in range(n):
                    for j in range(i + 1, n):
                        if bid_sets[i] & bid_sets[j]:
                            _unite(i, j)

                comps: dict[int, list[int]] = {}
                for i in range(n):
                    root = _find(i)
                    if root not in comps:
                        comps[root] = []
                    comps[root].append(i)

                for idxs in comps.values():
                    if len(idxs) == 1:
                        i = idxs[0]
                        or_ = others[i]
                        bid_map = arc_dict[or_]
                        mark = "square" if len(bid_sets[i]) > 1 else "dot"
                        any_gapped = any(bid_map.values())
                        solo_key = (res, or_, bt)
                        if solo_key not in solo_agg:
                            solo_agg[solo_key] = {"mark": "dot", "any_gapped": False, "count": 0}
                        solo_agg[solo_key]["count"] += 1
                        if mark == "square":
                            solo_agg[solo_key]["mark"] = "square"
                        if any_gapped:
                            solo_agg[solo_key]["any_gapped"] = True
                    else:
                        pattern = frozenset(others[i] for i in idxs)
                        comp_sets = [bid_sets[i] for i in idxs]
                        line_type = _line_type(comp_sets)

                        arc_infos: dict[str, dict] = {}
                        for i in idxs:
                            or_ = others[i]
                            bid_map = arc_dict[or_]
                            mark = "square" if len(bid_sets[i]) > 1 else "dot"
                            any_gapped = any(bid_map.values())
                            arc_infos[or_] = {"mark": mark, "any_gapped": any_gapped}

                        bind_key = (res, pattern, bt)
                        if bind_key not in binding_agg:
                            binding_agg[bind_key] = {
                                "arc_infos": {or_: dict(info) for or_, info in arc_infos.items()},
                                "line_type": line_type,
                                "count": 0,
                            }
                        else:
                            for or_, info in arc_infos.items():
                                existing = binding_agg[bind_key]["arc_infos"].get(or_)
                                if existing is None:
                                    binding_agg[bind_key]["arc_infos"][or_] = dict(info)
                                else:
                                    if info["mark"] == "square":
                                        existing["mark"] = "square"
                                    if info["any_gapped"]:
                                        existing["any_gapped"] = True
                        binding_agg[bind_key]["count"] += 1
                        if line_type == "dotted":
                            binding_agg[bind_key]["line_type"] = "dotted"

            for (res, pattern, bt), info in binding_agg.items():
                result.append({
                    "type": direction,
                    "resource": res,
                    "arcs": sorted(
                        [{"other_resource": or_, "bo_type": bt,
                          "mark": info["arc_infos"].get(or_, {}).get("mark", "dot"),
                          "is_gapped": info["arc_infos"].get(or_, {}).get("any_gapped", False)}
                         for or_ in pattern],
                        key=lambda x: x["other_resource"],
                    ),
                    "line_type": info["line_type"],
                    "count": info["count"],
                })

            for (res, other_res, bt), info in solo_agg.items():
                result.append({
                    "type": direction,
                    "resource": res,
                    "arcs": [{"other_resource": other_res, "bo_type": bt,
                               "mark": info["mark"], "is_gapped": info["any_gapped"]}],
                    "line_type": None,
                    "count": info["count"],
                })

        _build(src_obj_out, "output")
        _build(tgt_obj_in,  "input")
        return result

    @staticmethod
    def _bfs_bridges(
        eog_arcs: pl.DataFrame,
        resource_event_set: set[str],
        event_resources_dict: dict[str, list[str]],
        event_ts_dict: dict[str, int],
        max_gap: int | None,
    ) -> tuple[dict[str, str], dict[tuple[str, str, str], int]]:
        """
        Shared BFS + two-pass deduplication over the EOG.

        Returns (bo_type_map, canonical_bridges) where
        canonical_bridges: {(src_ev, tgt_ev, bid): gap} contains exactly one
        (src_ev, tgt_ev) pair per (bid, tgt_res) after dedup:
          Pass 2 — per (bid, tgt_ev): keep the bridge with the latest source
                   timestamp (removes orphan-repair sources superseded by the
                   dead-end repair source for the same object→target pair).
          Pass 1 — per (src_ev, bid, tgt_res): keep the bridge to the earliest
                   target event (removes phantom targets from orphan repair arcs
                   where one source reaches two target events for the same resource).
        """
        from collections import deque

        bo_adj: dict[str, dict[str, list[str]]] = {}
        bo_type_map: dict[str, str] = {}
        bo_all_events: dict[str, set[str]] = {}
        for row in eog_arcs.to_dicts():
            bid = row["businessobject_id"]
            if bid not in bo_adj:
                bo_adj[bid] = {}
                bo_type_map[bid] = row["businessobject_type"]
                bo_all_events[bid] = set()
            bo_adj[bid].setdefault(row["source_event"], []).append(row["target_event"])
            bo_all_events[bid].add(row["source_event"])
            bo_all_events[bid].add(row["target_event"])

        raw: dict[tuple[str, str, str], int] = {}
        for bid, adj in bo_adj.items():
            for src_ev in bo_all_events[bid] & resource_event_set:
                queue: deque = deque([(src_ev, 0)])
                visited: set[str] = {src_ev}
                while queue:
                    eid, gap = queue.popleft()
                    for neid in adj.get(eid, []):
                        if neid in visited:
                            continue
                        if neid in resource_event_set:
                            if max_gap is None or gap <= max_gap:
                                key = (src_ev, neid, bid)
                                if key not in raw or gap < raw[key]:
                                    raw[key] = gap
                            visited.add(neid)
                        else:
                            next_gap = gap + 1
                            if max_gap is None or next_gap <= max_gap:
                                visited.add(neid)
                                queue.append((neid, next_gap))

        # Pass 2: per (bid, tgt_ev) keep bridge with latest source timestamp.
        p2: dict[tuple[str, str], tuple[str, int]] = {}
        for (src_ev, tgt_ev, bid), gap in raw.items():
            src_ts = event_ts_dict.get(src_ev, 0)
            k = (bid, tgt_ev)
            if k not in p2 or src_ts > event_ts_dict.get(p2[k][0], 0):
                p2[k] = (src_ev, gap)

        # Pass 1: per (src_ev, bid, tgt_res) keep bridge to earliest target event.
        p1: dict[tuple[str, str, str], tuple[str, int]] = {}
        for (bid, tgt_ev), (src_ev, gap) in p2.items():
            tgt_ts = event_ts_dict.get(tgt_ev, 0)
            for tgt_res in event_resources_dict.get(tgt_ev, []):
                k = (src_ev, bid, tgt_res)
                if k not in p1 or tgt_ts < event_ts_dict.get(p1[k][0], 0):
                    p1[k] = (tgt_ev, gap)

        # Reconstruct canonical bridges from p1 (minimum gap when the same
        # (src_ev, tgt_ev, bid) appears via multiple target resources).
        canonical: dict[tuple[str, str, str], int] = {}
        for (src_ev, bid, _), (tgt_ev, gap) in p1.items():
            key = (src_ev, tgt_ev, bid)
            if key not in canonical or gap < canonical[key]:
                canonical[key] = gap

        return bo_type_map, canonical

    @classmethod
    def _resource_pairs_from_eog(
        cls,
        eog_arcs: pl.DataFrame,
        event_resources: pl.DataFrame,
        event_ts: pl.DataFrame,
        max_gap: int | None,
    ) -> pl.DataFrame:
        """
        Given EOG arcs (source_event, target_event, businessobject_id, businessobject_type),
        find all consecutive resource-event pairs reachable through the graph.

        Traverses forward from each resource event, stopping when the next resource
        event is reached and counting non-resource intermediate events as gap.
        Only pairs with gap <= max_gap are kept (all pairs if max_gap is None).

        Returns a DataFrame with columns:
            source, target, businessobject_type, time_delta
        """
        _resource_event_set: set[str] = set(event_resources.get_column("_eventId").to_list())
        _event_resources_dict: dict[str, list] = {
            r["_eventId"]: r["resources"] for r in event_resources.to_dicts()
        }
        _event_ts_dict: dict[str, int] = {
            r["_eventId"]: r["_timestampUnix"] for r in event_ts.to_dicts()
        }

        _bo_type_map, _canonical = cls._bfs_bridges(
            eog_arcs, _resource_event_set, _event_resources_dict, _event_ts_dict, max_gap,
        )

        # Expand canonical bridges to (src_event, tgt_event, src_res, tgt_res, bo_type)
        # rows.  All bo_ids sharing the same event-pair and type are accumulated.
        _pair_rows: dict[tuple[str, str, str, str, str], dict] = {}
        for (_src_eid, _tgt_eid, _bid), _ in _canonical.items():
            _btype = _bo_type_map[_bid]
            _src_ts = _event_ts_dict.get(_src_eid, 0)
            _tgt_ts = _event_ts_dict.get(_tgt_eid, 0)
            for _src in _event_resources_dict.get(_src_eid, []):
                for _tgt in _event_resources_dict.get(_tgt_eid, []):
                    _pair_key = (_src_eid, _tgt_eid, _src, _tgt, _btype)
                    if _pair_key not in _pair_rows:
                        _pair_rows[_pair_key] = {
                            "source": _src,
                            "target": _tgt,
                            "businessobject_type": _btype,
                            "businessobject_ids": [_bid],
                            "time_delta": _tgt_ts - _src_ts,
                            "start_unix": _src_ts,
                        }
                    else:
                        _pair_rows[_pair_key]["businessobject_ids"].append(_bid)
        _rows = list(_pair_rows.values())

        if _rows:
            return pl.DataFrame(_rows, schema={
                "source": pl.Utf8,
                "target": pl.Utf8,
                "businessobject_type": pl.Utf8,
                "businessobject_ids": pl.List(pl.Utf8),
                "time_delta": pl.Int64,
                "start_unix": pl.Int64,
            })
        return pl.DataFrame(schema={
            "source": pl.Utf8,
            "target": pl.Utf8,
            "businessobject_type": pl.Utf8,
            "businessobject_ids": pl.List(pl.Utf8),
            "time_delta": pl.Int64,
            "start_unix": pl.Int64,
        })


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