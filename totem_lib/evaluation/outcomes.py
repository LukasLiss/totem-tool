"""
What an algorithm produced, beyond how long it took.

A measurement records time and memory. For the dissertation that is not enough: the
conformance chapters need fitness and precision, and when a runtime looks odd later, the
explanation is usually in the model (more arcs, more marker groups, more levels). So
after the timed repeats, the output of the last repeat is described here and kept:

- `properties`: a small flat dict that goes into measurements.jsonl and the result
  tables, so figures can plot runtime against any of it without recomputing;
- `artifact`: the model or result itself, JSON-ready, saved as one file per
  measurement under `<run>/artifacts/<log>/`.

Each describe function takes the algorithm's output and returns an `Outcome`. They run
after timing and after memory is read, so they cost the measurement nothing.
"""

from __future__ import annotations

import dataclasses
from dataclasses import dataclass, field
from statistics import mean
from typing import Any

from totem_lib import occn_to_dict, totem_to_dict
from totem_lib.totem.totem import TR_DEPENDENT, TR_INITIATING, TR_PARALLEL


@dataclass
class Outcome:
    """
    The described output of one measurement.

    `reuse` is an object a later measurement of the same run loads back exactly,
    pickled next to the JSON artifact. The OCCN needs this: the conformance experiments
    filter the discovered net again, and the library's marker-group filter depends on
    the order of the groups, which a JSON round trip does not keep (see occn_json).
    """

    properties: dict[str, Any] = field(default_factory=dict)
    artifact: Any = None
    reuse: Any = None


# ---------------------------------------------------------------------------
# TOTeM
# ---------------------------------------------------------------------------

def totem_properties(totem) -> dict[str, Any]:
    """Size of a TOTeM model. Arcs are the D, I and P edges, as in the conformance paper."""
    graph = totem.tempgraph
    dependent = len(graph.get(TR_DEPENDENT, ()))
    initiating = len(graph.get(TR_INITIATING, ()))
    parallel = len(graph.get(TR_PARALLEL, ()))
    return {
        "totem_nodes": len(graph.get("nodes", ())),
        "totem_arcs": dependent + initiating + parallel,
        "totem_arcs_dependent": dependent,
        "totem_arcs_initiating": initiating,
        "totem_arcs_parallel": parallel,
        "totem_type_pairs": len(totem.cardinalities),
    }


def describe_totem(totem) -> Outcome:
    return Outcome(totem_properties(totem), {"totem": totem_to_dict(totem)})


def describe_totem_conformance(output) -> Outcome:
    """`output` is (model, TotemConformanceResult): both are kept."""
    totem, result = output
    overall = result.overall_metrics
    properties = totem_properties(totem)
    for dimension in ("temporal", "log_cardinality", "event_cardinality"):
        values = getattr(overall, dimension)
        properties[f"{dimension}_fitness"] = values.fitness
        properties[f"{dimension}_precision"] = values.precision
    artifact = {
        "totem": totem_to_dict(totem),
        "overall": dataclasses.asdict(overall),
        "object_types": [dataclasses.asdict(m) for m in result.object_type_metrics],
        "type_pairs": [dataclasses.asdict(m) for m in result.type_pair_metrics],
    }
    return Outcome(properties, artifact)


# ---------------------------------------------------------------------------
# OCCN
# ---------------------------------------------------------------------------

def occn_properties(occn) -> dict[str, Any]:
    """Size of an OCCN: activities, dependency arcs, marker groups and their markers."""
    groups = [
        group
        for groups_of_activity in (*occn.input_marker_groups.values(),
                                   *occn.output_marker_groups.values())
        for group in groups_of_activity
    ]
    return {
        "occn_activities": len(occn.activities),
        "occn_object_types": len(occn.object_types),
        "occn_object_type_names": sorted(occn.object_types),
        "occn_arcs": occn.dependency_graph.number_of_edges(),
        "occn_input_marker_groups": sum(len(g) for g in occn.input_marker_groups.values()),
        "occn_output_marker_groups": sum(len(g) for g in occn.output_marker_groups.values()),
        "occn_markers": sum(len(group.markers) for group in groups),
        "occn_threshold": occn.relative_occurrence_threshold,
    }


def occn_json(occn) -> dict:
    """
    The OCCN in the library's canonical JSON form (occn_to_dict), readable with
    occn_from_dict: every activity, arc and marker group with its support.

    It is the same net, but not in the same group order, and
    apply_relative_occurrence_threshold depends on that order: on the running example
    the net and its JSON copy filter to different marker groups from 0.3 on. So for
    reuse the net is pickled as well (Outcome.reuse).
    """
    return occn_to_dict(occn)


def picklable_occn(occn):
    """
    The same net, ready to pickle.

    Replay caches each marker group's `dict_representation`, a defaultdict built with a
    lambda, which pickle cannot store. The cache rebuilds itself on first use, so
    dropping it changes nothing but makes the net picklable whatever ran on it before.
    """
    for groups in (*occn.input_marker_groups.values(), *occn.output_marker_groups.values()):
        for group in groups:
            group.__dict__.pop("dict_representation", None)
    return occn


def describe_occn(occn) -> Outcome:
    return Outcome(occn_properties(occn), {"occn": occn_json(occn)},
                   reuse=picklable_occn(occn))


@dataclass(frozen=True)
class ReplayedUnit:
    """One process execution replayed on its own, with its own time."""

    unit_id: str
    events: int
    objects: int
    object_types: int
    seconds: float
    status: str
    explored_states: int


def describe_occn_fitness(output) -> Outcome:
    """`output` is (occn, [ReplayedUnit, ...]) from algorithms.replay_each."""
    occn, units = output
    fitting = sum(u.status == "fitting" for u in units)
    non_fitting = sum(u.status == "non_fitting" for u in units)
    conclusive = fitting + non_fitting
    properties = occn_properties(occn)
    properties.update({
        "executions": len(units),
        "fitting_executions": fitting,
        "non_fitting_executions": non_fitting,
        "inconclusive_executions": len(units) - conclusive,
        "fitness": fitting / conclusive if conclusive else None,
        "mean_execution_s": mean(u.seconds for u in units) if units else None,
        "max_execution_s": max((u.seconds for u in units), default=None),
    })
    artifact = {
        "occn": occn_json(occn),
        "executions": [dataclasses.asdict(u) for u in units],
    }
    return Outcome(properties, artifact)


# ---------------------------------------------------------------------------
# Process areas
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ProcessAreaRun:
    """Process areas plus how the pipeline's time split between its two steps."""

    totem: Any
    areas: dict
    totem_seconds: float
    ilp_seconds: float


def describe_process_areas(output: ProcessAreaRun) -> Outcome:
    """The figures of the process-area paper's Table 2, plus the time split."""
    areas = [
        (sorted(types), sorted(activities))
        for level in output.areas.values()
        for types, activities in level
    ]
    total = output.totem_seconds + output.ilp_seconds
    properties = {
        **totem_properties(output.totem),
        "levels": len(output.areas),
        "areas": len(areas),
        "avg_types_per_area": mean(len(t) for t, _ in areas) if areas else None,
        "avg_activities_per_area": mean(len(a) for _, a in areas) if areas else None,
        "totem_seconds": output.totem_seconds,
        "ilp_seconds": output.ilp_seconds,
        "totem_share": output.totem_seconds / total if total else None,
    }
    artifact = {
        "totem": totem_to_dict(output.totem),
        "levels": [
            {"level": float(level),
             "areas": [{"object_types": sorted(types), "activities": sorted(activities)}
                       for types, activities in output.areas[level]]}
            for level in sorted(output.areas)
        ],
    }
    return Outcome(properties, artifact)


# ---------------------------------------------------------------------------
# Everything else
# ---------------------------------------------------------------------------

def describe_graph(graph) -> Outcome:
    """Node and edge counts of a networkx-based DFG; the graph itself is not saved."""
    properties = {}
    for name in ("number_of_nodes", "number_of_edges"):
        method = getattr(graph, name, None)
        if callable(method):
            properties[name.removeprefix("number_of_")] = method()
    return Outcome(properties)
