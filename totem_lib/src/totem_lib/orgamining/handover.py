"""Object-centric handover-of-work discovery.

Entry points are :func:`discover_handover` and :func:`compute_footprint`; both
accept the polars ``ObjectCentricEventLog`` as well as an
:class:`~totem_lib.ocel.ocel_duckdb.OcelDuckDB`. The algorithm reads either
through :class:`~totem_lib.orgamining._source.EventObjectSource`, so the
computation is the same for both representations.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, List, Literal, get_args

import polars as pl
import networkx as nx

from ._source import EventObjectSource
from ..ocel.ocel_duckdb import OcelDuckDB

if TYPE_CHECKING:  # pragma: no cover - typing only
    from matplotlib.axes import Axes

    from ..ocel.ocel import ObjectCentricEventLog as OCEL

logger = logging.getLogger(__name__)

Normalization = Literal["by_source", "by_target", "by_arcs_in_eog", "by_total_weight"]
NormalizationScope = Literal["global", "per_bo_type"]

# Allowed values of ``normalization`` / ``normalization_scope``.
NORMALIZATIONS: tuple[str, ...] = get_args(Normalization)
NORMALIZATION_SCOPES: tuple[str, ...] = get_args(NormalizationScope)


def discover_handover(
    ocel: "OCEL | OcelDuckDB",
    resource_types: List[str],
    business_object_types: List[str],
    max_gap: int | None = None,
    normalization: Normalization = "by_arcs_in_eog",
    normalization_scope: NormalizationScope = "global",
    parallel_threshold: float | None = None,
    min_parallel_observations: int = 1,
    cluster_map: dict[str, str] | None = None,
    cluster_by_ot: bool = False,
    include_flows: bool = False,
    include_bindings: bool = False,
) -> "HandoverGraph":
    """
    Discover the object-centric handover-of-work graph.

    Parameters
    ----------
    ocel
        The event log, either an ``ObjectCentricEventLog`` or an ``OcelDuckDB``.
        For an ``OcelDuckDB`` shared between threads the caller holds ``db.lock``.
    resource_types
        Object types whose objects are the resources (graph nodes).
    business_object_types
        Object types whose objects are handed over between resources.
    max_gap
        Maximum number of intermediate events without a resource between two
        resource events; ``None`` for no limit.
    normalization
        How an edge's ``count`` is normalised into its ``weight``, one of
        :data:`NORMALIZATIONS`.
    normalization_scope
        ``"global"`` or ``"per_bo_type"`` (one denominator per business object type).
    parallel_threshold
        If set, directly-follows pairs of business object activities that the
        footprint marks as parallel (``|dependency| <= parallel_threshold``)
        are not treated as handovers.
    min_parallel_observations
        Minimum number of observations for an activity pair to count as parallel.
    cluster_map
        ``{resource id: cluster id}``; resources are collapsed into clusters
        before handovers are counted.
    cluster_by_ot
        Collapse every resource into its object type.
    include_flows
        Store the individual handovers in ``graph.graph["animation_flows"]``.
    include_bindings
        Store the binding annotations in ``graph.graph["bindings"]``
        (see :meth:`HandoverGraph.bindings_table`).

    Returns
    -------
    HandoverGraph
        Nodes carry ``object_type`` and ``event_count``. Each edge carries
        ``count`` (number of handovers), ``weight`` (``count`` normalised
        according to ``normalization``), ``businessobject_type`` and
        ``avg_time`` / ``min_time`` / ``max_time`` (time between the source
        and the target event, in seconds).
    """
    kwargs = dict(
        max_gap=max_gap,
        normalization=normalization,
        normalization_scope=normalization_scope,
        parallel_threshold=parallel_threshold,
        min_parallel_observations=min_parallel_observations,
        cluster_map=cluster_map,
        cluster_by_ot=cluster_by_ot,
        include_flows=include_flows,
        include_bindings=include_bindings,
    )
    if isinstance(ocel, OcelDuckDB):
        return HandoverGraph.from_ocel_db(ocel, resource_types, business_object_types, **kwargs)
    return HandoverGraph.from_ocel(ocel, resource_types, business_object_types, **kwargs)


def compute_footprint(ocel: "OCEL | OcelDuckDB", object_types: List[str]) -> pl.DataFrame:
    """
    Footprint matrix over activities, computed per object type from its lifecycles.

    Accepts an ``ObjectCentricEventLog`` or an ``OcelDuckDB``. Returns one row
    per (object type, activity a, activity b) with the columns
    ``businessobject_type``, ``activity_a``, ``activity_b``, ``relation``
    (``→``, ``←``, ``||``, ``#``), ``count_ab``, ``count_ba`` and ``dependency``.
    """
    if isinstance(ocel, OcelDuckDB):
        return HandoverGraph.compute_footprint_db(ocel, object_types)
    return HandoverGraph.compute_footprint(ocel, object_types)


class HandoverGraph(nx.MultiDiGraph):
    """
    Handover-of-work graph: resources as nodes, one edge per (source resource,
    target resource, business object type) carrying the handover ``count``,
    its normalised ``weight`` and timing statistics.
    """
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

    @classmethod
    def from_ocel(cls, ocel: "OCEL", resource_types: List[str], business_object_types: List[str], max_gap: int | None = None,
                  normalization: Normalization = "by_arcs_in_eog",
                  normalization_scope: NormalizationScope = "global",
                  parallel_threshold: float | None = None,
                  min_parallel_observations: int = 1,
                  cluster_map: dict[str, str] | None = None,
                  cluster_by_ot: bool = False,
                  include_flows: bool = False,
                  include_bindings: bool = False) -> 'HandoverGraph':
        """Discover the handover graph from a polars ``ObjectCentricEventLog``."""
        source = EventObjectSource.from_ocel(ocel, list(resource_types) + list(business_object_types))
        return cls._from_source(
            source, resource_types, business_object_types, max_gap=max_gap,
            normalization=normalization, normalization_scope=normalization_scope,
            parallel_threshold=parallel_threshold, min_parallel_observations=min_parallel_observations,
            cluster_map=cluster_map, cluster_by_ot=cluster_by_ot,
            include_flows=include_flows, include_bindings=include_bindings,
        )

    @classmethod
    def from_ocel_db(cls, db: "OcelDuckDB", resource_types: List[str], business_object_types: List[str], max_gap: int | None = None,
                     normalization: Normalization = "by_arcs_in_eog",
                     normalization_scope: NormalizationScope = "global",
                     parallel_threshold: float | None = None,
                     min_parallel_observations: int = 1,
                     cluster_map: dict[str, str] | None = None,
                     cluster_by_ot: bool = False,
                     include_flows: bool = False,
                     include_bindings: bool = False) -> 'HandoverGraph':
        """Discover the handover graph from an :class:`OcelDuckDB`.

        Only the event/object rows of the requested resource and business
        object types are read from the database (one SQL query); everything
        else is shared with :meth:`from_ocel`. The caller is responsible for
        holding ``db.lock`` when the connection is shared between threads.
        """
        source = EventObjectSource.from_ocel_db(db, list(resource_types) + list(business_object_types))
        return cls._from_source(
            source, resource_types, business_object_types, max_gap=max_gap,
            normalization=normalization, normalization_scope=normalization_scope,
            parallel_threshold=parallel_threshold, min_parallel_observations=min_parallel_observations,
            cluster_map=cluster_map, cluster_by_ot=cluster_by_ot,
            include_flows=include_flows, include_bindings=include_bindings,
        )

    @classmethod
    def _from_source(cls, source: EventObjectSource, resource_types: List[str], business_object_types: List[str], max_gap: int | None = None,
                     normalization: Normalization = "by_arcs_in_eog",
                     normalization_scope: NormalizationScope = "global",
                     parallel_threshold: float | None = None,
                     min_parallel_observations: int = 1,
                     cluster_map: dict[str, str] | None = None,
                     cluster_by_ot: bool = False,
                     include_flows: bool = False,
                     include_bindings: bool = False) -> 'HandoverGraph':
        """
        Core of the discovery, independent of the log representation.

        ``source.event_objects`` holds one row per (event, object) pair for
        the resource and business object types; ``source.object_type_by_id``
        maps every such object to its type.
        """

        # Get the object ids of the resources and business objects
        resource_ids = source.object_ids_of_types(resource_types)
        businessobject_ids = source.object_ids_of_types(business_object_types)

        event_objects = source.event_objects

        logger.debug("Event Objects (Explode)\n%s", event_objects)

        event_resources = (
            event_objects
            .filter(pl.col("_objId").is_in(resource_ids))
            .group_by("_eventId")
            .agg(
                pl.col("_objId").unique().alias("resources")
            )
        )

        logger.debug("Event Resources\n%s", event_resources)

        # When cluster_by_ot is set, auto-generate a cluster_map that collapses
        # every resource object to its object type name (e.g. "Mike" → "employee").
        if cluster_by_ot:
            cluster_map = dict(source.type_map_for(resource_types))

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
        businessobject_type_by_id = source.type_map_for(business_object_types)
        resource_type_by_id = dict(source.type_map_for(resource_types))

        if cluster_map:
            if cluster_by_ot:
                # Cluster IDs are the type names themselves, so they keep their type.
                for obj_type in resource_types:
                    resource_type_by_id[obj_type] = obj_type
            else:
                for cluster_id in set(cluster_map.values()):
                    resource_type_by_id[cluster_id] = "cluster"


        # Explicit schema: with no business objects (e.g. the global filter
        # removed every type) an untyped empty frame cannot be joined on.
        businessobject_type_df = pl.DataFrame(
            {
                "businessobject_id": list(businessobject_type_by_id.keys()),
                "businessobject_type": list(businessobject_type_by_id.values()),
            },
            schema={"businessobject_id": pl.Utf8, "businessobject_type": pl.Utf8},
        )


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

        logger.debug("Event Businessobjects\n%s", event_businessobjects)


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

        logger.debug("Event-Object Graph Arcs\n%s", eog_arcs)


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

        logger.debug("EOG Arcs Unique\n%s", eog_arcs_unique)


        eog_arc_count = eog_arcs_unique.height

        # Per-type arc counts for normalisation — fixed to the original EOG so
        # that repair arcs added by the parallel filter do not inflate the denominator.
        eog_arc_count_by_type = (
            eog_arcs
            .select(["source_event", "target_event", "businessobject_type"])
            .unique()
            .group_by("businessobject_type")
            .len()
            .rename({"len": "_arc_count"})
        )

        if parallel_threshold is not None:
            footprint = cls._footprint_from_source(source, business_object_types)

            logger.debug("footprint\n%s", footprint)

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

            logger.debug("parallel pairs %s", parallel_set)

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

            logger.debug("Modified EOG arcs\n%s", modified_eog_arcs)

            # Update eog_arcs for handover computation; eog_arc_count and
            # eog_arc_count_by_type are kept from the original EOG for normalisation.
            eog_arcs = modified_eog_arcs
            eog_arcs_unique = (
                modified_eog_arcs
                .group_by(["source_event", "target_event"])
                .agg([
                    pl.col("businessobject_id").unique().alias("businessobjects"),
                    pl.col("businessobject_type").unique().alias("businessobject_types"),
                ])
            )

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
                pl.len().alias("count"),
                pl.col("time_delta").mean().alias("avg_time"),
                pl.col("time_delta").min().alias("min_time"),
                pl.col("time_delta").max().alias("max_time"),
            ])
            .sort("count", descending=True)
        )

        logger.debug("Handover edges\n%s", handover_edges)

        # Normalise each edge's count into its weight according to the chosen strategy and scope.
        # global: denominator is computed across all business object types together.
        # per_bo_type: denominator is computed separately for each business object type,
        #              so high-traffic types no longer dominate low-traffic ones visually.
        if normalization == "by_source":
            group_cols = ["source", "businessobject_type"] if normalization_scope == "per_bo_type" else ["source"]
            source_totals = handover_edges.group_by(group_cols).agg(pl.col("count").sum().alias("_source_total"))
            handover_edges = (
                handover_edges
                .join(source_totals, on=group_cols, how="left")
                .with_columns((pl.col("count") / pl.col("_source_total")).alias("weight"))
                .drop("_source_total")
            )

        elif normalization == "by_target":
            group_cols = ["target", "businessobject_type"] if normalization_scope == "per_bo_type" else ["target"]
            target_totals = handover_edges.group_by(group_cols).agg(pl.col("count").sum().alias("_target_total"))
            handover_edges = (
                handover_edges
                .join(target_totals, on=group_cols, how="left")
                .with_columns((pl.col("count") / pl.col("_target_total")).alias("weight"))
                .drop("_target_total")
            )

        elif normalization == "by_arcs_in_eog":
            if normalization_scope == "per_bo_type":
                logger.debug("bo arc counts\n%s", eog_arc_count_by_type)
                handover_edges = (
                    handover_edges
                    .join(eog_arc_count_by_type, on="businessobject_type", how="left")
                    .with_columns((pl.col("count") / pl.col("_arc_count")).alias("weight"))
                    .drop("_arc_count")
                )
            else:
                handover_edges = handover_edges.with_columns(
                    (pl.col("count") / eog_arc_count).alias("weight")
                )

        elif normalization == "by_total_weight":
            if normalization_scope == "per_bo_type":
                bo_totals = handover_edges.group_by("businessobject_type").agg(pl.col("count").sum().alias("_bo_total"))
                handover_edges = (
                    handover_edges
                    .join(bo_totals, on="businessobject_type", how="left")
                    .with_columns((pl.col("count") / pl.col("_bo_total")).alias("weight"))
                    .drop("_bo_total")
                )
            else:
                total = handover_edges.select(pl.col("count").sum()).item()
                handover_edges = handover_edges.with_columns(
                    (pl.col("count") / total).alias("weight")
                )

        if logger.isEnabledFor(logging.DEBUG) and not handover_edges.is_empty():
            logger.debug("weight sum %s", handover_edges.select(pl.col("weight").sum()).item())


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
                weight=row["weight"],
                count=row["count"],
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
        _ts = event_ts_dict or {}
        bo_type_map, raw = cls._bfs_bridges(eog_arcs, resource_event_set, max_gap)
        _, canonical = cls._canonical_from_raw(raw, event_resources_dict, _ts)

        # Expand canonical into per-(src_event, bid) output and input maps.
        # Both directions use the same resource-level canonical: the resource-level
        # passes resolve orphan-repair duplicates within each resource pair while
        # preserving independent handovers from different source resources.
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

        result: list[dict] = []

        def _line_type(arc_bo_sets: list[set]) -> str:
            """solid if every arc carries exactly the same objects; dotted otherwise."""
            return "solid" if all(s == arc_bo_sets[0] for s in arc_bo_sets[1:]) else "dotted"

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

    def bindings_table(self) -> pl.DataFrame:
        """
        Return all bindings as a flat Polars DataFrame.

        One row per arc within each binding.  Columns:
          binding_id   – integer grouping all arcs that belong to the same binding
          direction    – "output" or "input"
          resource     – the resource node this binding is attached to
          other_resource – the arc's counterpart (equals resource for self-loops)
          is_self_loop – True when other_resource == resource
          bo_type      – business-object type carried by this arc
          mark         – "dot" (single object) or "square" (multiple objects)
          is_gapped    – True if any occurrence had intermediate non-resource events
          line_type    – "solid", "dotted", or None (solo / single-arc binding)
          count        – how often this binding pattern was observed
          pattern      – human-readable binding pattern, e.g. "{A, B, A(self)}"
        """
        bindings: list[dict] = self.graph.get("bindings", [])
        if not bindings:
            return pl.DataFrame()

        rows = []
        for binding_id, b in enumerate(bindings):
            resource = b["resource"]
            pattern_parts = []
            for arc in b["arcs"]:
                label = arc["other_resource"]
                if arc["other_resource"] == resource:
                    label += " (self)"
                pattern_parts.append(label)
            pattern = "{" + ", ".join(sorted(pattern_parts)) + "}"

            for arc in b["arcs"]:
                rows.append({
                    "binding_id":    binding_id,
                    "direction":     b["type"],
                    "resource":      resource,
                    "other_resource": arc["other_resource"],
                    "is_self_loop":  arc["other_resource"] == resource,
                    "bo_type":       arc["bo_type"],
                    "mark":          arc["mark"],
                    "is_gapped":     arc["is_gapped"],
                    "line_type":     b["line_type"],
                    "count":         b["count"],
                    "pattern":       pattern,
                })

        return pl.DataFrame(rows, schema={
            "binding_id":     pl.Int32,
            "direction":      pl.Utf8,
            "resource":       pl.Utf8,
            "other_resource": pl.Utf8,
            "is_self_loop":   pl.Boolean,
            "bo_type":        pl.Utf8,
            "mark":           pl.Utf8,
            "is_gapped":      pl.Boolean,
            "line_type":      pl.Utf8,
            "count":          pl.Int32,
            "pattern":        pl.Utf8,
        })

    @staticmethod
    def _bfs_bridges(
        eog_arcs: pl.DataFrame,
        resource_event_set: set[str],
        max_gap: int | None,
    ) -> tuple[dict[str, str], dict[tuple[str, str, str], int]]:
        """
        BFS over the EOG to find raw bridges between consecutive resource events.

        Returns (bo_type_map, raw_bridges) where raw_bridges is
        {(src_ev, tgt_ev, bid): gap}.  No deduplication is applied; callers
        apply their own pass logic depending on their semantics.
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

        return bo_type_map, raw

    @staticmethod
    def _canonical_from_raw(
        raw: dict[tuple[str, str, str], int],
        event_resources_dict: dict[str, list[str]],
        event_ts_dict: dict[str, int],
    ) -> tuple[dict[tuple, tuple[str, int]], dict[tuple[str, str, str], int]]:
        """
        Apply resource-level two-pass deduplication to raw BFS bridges.

        Returns (p1, canonical) where:
          p1        — {(src_ev, src_res, tgt_res, bid): (tgt_ev, gap)}
                      The exact 5-tuple handovers per Definition 4.8.  Use this
                      for resource-pair expansion to avoid phantom duplicates.
          canonical — {(src_ev, tgt_ev, bid): gap}
                      Event-level bridge set for binding computation (which needs
                      event-level connectivity, not resource-pair specificity).

        Pass 2 — key (src_res, tgt_res, bid, tgt_ev): within each resource pair,
        keep the bridge with the latest source timestamp (Definition 4.8 latest-
        source condition).

        Pass 1 — key (src_ev, src_res, tgt_res, bid): keep the bridge to the
        earliest target event (Definition 4.8 earliest-target condition).
        """
        # Pass 2: per (src_res, tgt_res, bid, tgt_ev) keep bridge with latest src ts.
        p2: dict[tuple, tuple[str, int]] = {}
        for (src_ev, tgt_ev, bid), gap in raw.items():
            src_ts = event_ts_dict.get(src_ev, 0)
            for src_res in event_resources_dict.get(src_ev, []):
                for tgt_res in event_resources_dict.get(tgt_ev, []):
                    k = (src_res, tgt_res, bid, tgt_ev)
                    if k not in p2 or src_ts > event_ts_dict.get(p2[k][0], 0):
                        p2[k] = (src_ev, gap)

        # Pass 1: per (src_ev, src_res, tgt_res, bid) keep bridge to earliest tgt.
        p1: dict[tuple, tuple[str, int]] = {}
        for (src_res, tgt_res, bid, tgt_ev), (src_ev, gap) in p2.items():
            tgt_ts = event_ts_dict.get(tgt_ev, 0)
            k = (src_ev, src_res, tgt_res, bid)
            if k not in p1 or tgt_ts < event_ts_dict.get(p1[k][0], 0):
                p1[k] = (tgt_ev, gap)

        # Reconstruct canonical (min gap when same bridge appears via multiple pairs).
        canonical: dict[tuple[str, str, str], int] = {}
        for (src_ev, *_, bid), (tgt_ev, gap) in p1.items():
            key = (src_ev, tgt_ev, bid)
            if key not in canonical or gap < canonical[key]:
                canonical[key] = gap
        return p1, canonical

    _HANDOVER_SCHEMA = {
        "source":              pl.Utf8,
        "target":              pl.Utf8,
        "businessobject_type": pl.Utf8,
        "businessobject_ids":  pl.List(pl.Utf8),
        "time_delta":          pl.Int64,
        "start_unix":          pl.Int64,
    }

    @classmethod
    def _collapse_p1(
        cls,
        p1: dict,
        bo_type_map: dict[str, str],
        event_ts_dict: dict[str, int],
    ) -> pl.DataFrame:
        """
        Collapse the filtered 5-tuple set p1 into a handover-instances DataFrame.

        Groups entries sharing the same (src_event, tgt_event, src_resource,
        tgt_resource, bo_type) key, accumulating their business-object ids.
        """
        pair_rows: dict[tuple, dict] = {}
        for (src_eid, src_res, tgt_res, bid), (tgt_eid, _) in p1.items():
            btype  = bo_type_map[bid]
            src_ts = event_ts_dict.get(src_eid, 0)
            tgt_ts = event_ts_dict.get(tgt_eid, 0)
            key    = (src_eid, tgt_eid, src_res, tgt_res, btype)
            if key not in pair_rows:
                pair_rows[key] = {
                    "source":              src_res,
                    "target":              tgt_res,
                    "businessobject_type": btype,
                    "businessobject_ids":  [bid],
                    "time_delta":          tgt_ts - src_ts,
                    "start_unix":          src_ts,
                }
            else:
                pair_rows[key]["businessobject_ids"].append(bid)
        rows = list(pair_rows.values())
        if rows:
            return pl.DataFrame(rows, schema=cls._HANDOVER_SCHEMA)
        return pl.DataFrame(schema=cls._HANDOVER_SCHEMA)

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
            source, target, businessobject_type, businessobject_ids, time_delta, start_unix
        """
        _resource_event_set: set[str] = set(event_resources.get_column("_eventId").to_list())
        _event_resources_dict: dict[str, list] = {
            r["_eventId"]: r["resources"] for r in event_resources.to_dicts()
        }
        _event_ts_dict: dict[str, int] = {
            r["_eventId"]: r["_timestampUnix"] for r in event_ts.to_dicts()
        }
        _bo_type_map, _raw = cls._bfs_bridges(eog_arcs, _resource_event_set, max_gap)
        _p1, _ = cls._canonical_from_raw(_raw, _event_resources_dict, _event_ts_dict)
        return cls._collapse_p1(_p1, _bo_type_map, _event_ts_dict)

    def plot(
        self,
        ax: "Axes | None" = None,
        *,
        edge_label: Literal["count", "weight", "avg_time"] | None = "count",
        min_weight: float = 0.0,
        bo_types: List[str] | None = None,
        layout: Literal["spring", "circular", "shell"] = "spring",
        pos: dict | None = None,
        node_size_by: Literal["event_count"] | None = "event_count",
        colors: dict[str, str] | None = None,
        title: str | None = None,
        show: bool | None = None,
    ) -> "Axes":
        """
        Draw the handover graph with matplotlib.

        Nodes are resources, coloured by resource object type. Each edge is
        one (source, target, business object type) handover, coloured by
        business object type and drawn wider the higher its ``weight``.
        Handovers of several business object types between the same two
        resources get separate curves.

        Parameters
        ----------
        ax
            Axes to draw on. If ``None``, a new figure is created.
        edge_label
            Edge attribute written on every edge: ``"count"``, ``"weight"``,
            ``"avg_time"`` (formatted as a duration) or ``None`` for no labels.
        min_weight
            Edges with a lower ``weight`` are left out, and so are resources
            left without edges.
        bo_types
            Business object types whose handovers are drawn; ``None`` for all.
        layout
            ``"spring"`` (force-directed), ``"circular"`` or ``"shell"`` (one
            ring per resource object type). Ignored when ``pos`` is given.
        pos
            ``{node: (x, y)}``, e.g. to keep the same layout across plots.
        node_size_by
            ``"event_count"`` sizes nodes by the resource's number of events;
            ``None`` draws all nodes the same size.
        colors
            ``{object type: matplotlib colour}`` for resource and business
            object types; unlisted types get a default colour.
        title
            Axes title.
        show
            Call ``plt.show()`` at the end. Defaults to ``True`` when the
            method creates the figure and ``False`` when ``ax`` is given.

        Returns
        -------
        matplotlib.axes.Axes
            The axes the graph was drawn on.
        """
        import matplotlib.pyplot as plt
        import matplotlib.patches as mpatches

        if edge_label not in ("count", "weight", "avg_time", None):
            raise ValueError(
                f"edge_label must be 'count', 'weight', 'avg_time' or None, got {edge_label!r}"
            )
        if layout not in ("spring", "circular", "shell"):
            raise ValueError(f"layout must be 'spring', 'circular' or 'shell', got {layout!r}")
        if node_size_by not in ("event_count", None):
            raise ValueError(f"node_size_by must be 'event_count' or None, got {node_size_by!r}")

        if ax is None:
            _, ax = plt.subplots(figsize=(10, 8))
            if show is None:
                show = True
        ax.set_axis_off()
        if title:
            ax.set_title(title)

        def scale(value, lo, hi, out_lo, out_hi):
            if hi == lo:
                return (out_lo + out_hi) / 2
            return out_lo + (value - lo) / (hi - lo) * (out_hi - out_lo)

        # The edges that pass the filters and the resources they touch. The
        # sort fixes the order of parallel edges, which decides their curve.
        graph = nx.MultiDiGraph()
        for u, v, key, data in sorted(
            self.edges(keys=True, data=True), key=lambda e: (str(e[0]), str(e[1]), str(e[2]))
        ):
            if data.get("weight", 0) < min_weight:
                continue
            if bo_types is not None and data.get("businessobject_type") not in bo_types:
                continue
            graph.add_node(u, **self.nodes[u])
            graph.add_node(v, **self.nodes[v])
            graph.add_edge(u, v, key=key, **data)

        if graph.number_of_edges() == 0:
            ax.text(0.5, 0.5, "No handovers to show", ha="center", va="center",
                    transform=ax.transAxes)
            if show:
                plt.show()
            return ax

        # -------------------------
        # Layout
        # -------------------------
        if pos is not None:
            missing = [n for n in graph.nodes if n not in pos]
            if missing:
                raise ValueError(f"pos has no position for {missing}")
        elif layout == "circular":
            pos = nx.circular_layout(graph)
        elif layout == "shell":
            shells: dict[str, list] = {}
            for node, obj_type in graph.nodes(data="object_type", default="unknown"):
                shells.setdefault(obj_type, []).append(node)
            pos = nx.shell_layout(graph, nlist=[shells[t] for t in sorted(shells)])
        else:
            pos = nx.spring_layout(graph, k=1.5, iterations=200, seed=42)

        # -------------------------
        # Colours by resource type (nodes) and business object type (edges)
        # -------------------------
        colors = colors or {}

        def color_map(types, cmap_name):
            cmap = plt.get_cmap(cmap_name)
            return {t: colors.get(t, cmap(i % cmap.N)) for i, t in enumerate(types)}

        node_types = sorted({t for _, t in graph.nodes(data="object_type", default="unknown")})
        edge_types = sorted(
            {t for *_, t in graph.edges(data="businessobject_type", default="unknown")}
        )
        node_type_to_color = color_map(node_types, "Set2")
        edge_type_to_color = color_map(edge_types, "tab10")

        # -------------------------
        # Nodes
        # -------------------------
        nodelist = list(graph.nodes)
        if node_size_by == "event_count":
            event_counts = [graph.nodes[n].get("event_count", 0) for n in nodelist]
            lo, hi = min(event_counts), max(event_counts)
            node_sizes = [scale(c, lo, hi, 600, 2400) for c in event_counts]
        else:
            node_sizes = [1500] * len(nodelist)

        nx.draw_networkx_nodes(
            graph,
            pos,
            nodelist=nodelist,
            node_size=node_sizes,
            node_color=[
                node_type_to_color[graph.nodes[n].get("object_type", "unknown")]
                for n in nodelist
            ],
            edgecolors="black",
            ax=ax,
        )
        nx.draw_networkx_labels(graph, pos, font_size=9, ax=ax)

        # -------------------------
        # Edges
        # -------------------------
        edgelist = list(graph.edges(keys=True))
        edge_data = [graph.edges[e] for e in edgelist]
        weights = [d.get("weight", 0) for d in edge_data]
        lo, hi = min(weights), max(weights)

        # networkx numbers the edges between the same (source, target) pair
        # 0, 1, 2, ... and gives edge i the i-th connection style, so every
        # business object type gets its own curve. Opposite directions bend
        # to opposite sides.
        parallel = max(graph.number_of_edges(u, v) for u, v, _ in edgelist)
        connectionstyle = [f"arc3,rad={0.15 + 0.15 * i:.2f}" for i in range(parallel)]

        nx.draw_networkx_edges(
            graph,
            pos,
            edgelist=edgelist,
            edge_color=[
                edge_type_to_color[d.get("businessobject_type", "unknown")] for d in edge_data
            ],
            width=[scale(w, lo, hi, 1.0, 6.0) for w in weights],
            arrows=True,
            arrowsize=15,
            connectionstyle=connectionstyle,
            nodelist=nodelist,
            node_size=node_sizes,
            ax=ax,
        )

        if edge_label is not None:
            def format_label(value):
                if value is None:
                    return "–"
                if edge_label == "count":
                    return str(int(value))
                if edge_label == "weight":
                    return f"{value:.3f}"
                # avg_time is in seconds
                for unit, seconds in (("d", 86400), ("h", 3600), ("min", 60)):
                    if abs(value) >= seconds:
                        return f"{value / seconds:.1f} {unit}"
                return f"{value:.0f} s"

            nx.draw_networkx_edge_labels(
                graph,
                pos,
                edge_labels={
                    e: format_label(d.get(edge_label)) for e, d in zip(edgelist, edge_data)
                },
                connectionstyle=connectionstyle,
                font_size=8,
                ax=ax,
            )

        # -------------------------
        # Legends
        # -------------------------
        resource_legend = ax.legend(
            handles=[mpatches.Patch(color=node_type_to_color[t], label=t) for t in node_types],
            title="Resource type",
            loc="upper left",
        )
        ax.add_artist(resource_legend)
        ax.legend(
            handles=[mpatches.Patch(color=edge_type_to_color[t], label=t) for t in edge_types],
            title="Handover object type",
            loc="upper right",
        )

        if show:
            plt.show()
        return ax

    @classmethod
    def compute_footprint(
        cls,
        ocel: "OCEL",
        object_types: List[str],
    ) -> pl.DataFrame:
        """Footprint per object type from a polars ``ObjectCentricEventLog``."""
        source = EventObjectSource.from_ocel(ocel, object_types)
        return cls._footprint_from_source(source, object_types)

    @classmethod
    def compute_footprint_db(
        cls,
        db: "OcelDuckDB",
        object_types: List[str],
    ) -> pl.DataFrame:
        """Footprint per object type from an :class:`OcelDuckDB`."""
        source = EventObjectSource.from_ocel_db(db, object_types)
        return cls._footprint_from_source(source, object_types)

    @classmethod
    def _footprint_from_source(
        cls,
        source: EventObjectSource,
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
        all_rows = []

        for obj_type in object_types:
            event_objects = source.restricted_to([obj_type])

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

        if not all_rows:
            return pl.DataFrame(schema={
                "businessobject_type": pl.Utf8,
                "activity_a":          pl.Utf8,
                "activity_b":          pl.Utf8,
                "relation":            pl.Utf8,
                "count_ab":            pl.Int64,
                "count_ba":            pl.Int64,
                "dependency":          pl.Float64,
            })
        return pl.DataFrame(all_rows)