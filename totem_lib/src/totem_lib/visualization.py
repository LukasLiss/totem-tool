"""
Visualization module for totem_lib models.

Provides Graphviz-based rendering, plotting, and Jupyter inline display for:
- OCPN (Object-Centric Petri Nets)
- OCCausalNet (Object-Centric Causal Nets)
- Totem (Temporal Object Type Models)
- OCDFG / CCDFG (Object-Centric Directly-Follows Graphs)
- ProcessAreas (Process Area hierarchies)
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

import graphviz

DEFAULT_PALETTE = [
    "#4E79A7",  # blue
    "#F28E2B",  # orange
    "#E15759",  # red
    "#76B7B2",  # teal
    "#59A14F",  # green
    "#EDC948",  # yellow
    "#B07AA1",  # purple
    "#FF9DA7",  # pink
    "#9C755F",  # brown
    "#BAB0AC",  # gray
]

GV_FONT = "Helvetica"
GV_FONTSIZE_NODE = "10"
GV_FONTSIZE_EDGE = "8"


def get_object_type_colors(object_types: Sequence[str]) -> Dict[str, str]:
    """Deterministically maps each object type to a distinct color from DEFAULT_PALETTE."""
    sorted_types = sorted(set(object_types))
    return {ot: DEFAULT_PALETTE[i % len(DEFAULT_PALETTE)] for i, ot in enumerate(sorted_types)}


class VisualizableMixin:
    """Mixin providing .plot(), .view(), and Jupyter _repr_*_ methods via to_graphviz()."""

    def to_graphviz(self, **kwargs) -> graphviz.Digraph:
        raise NotImplementedError("Subclasses must implement to_graphviz()")

    def plot(self, **kwargs) -> graphviz.Digraph:
        """Return the Graphviz Digraph representation for visual rendering."""
        return self.to_graphviz(**kwargs)

    def view(self, **kwargs) -> Any:
        """Open the rendered model with the system default viewer."""
        return self.to_graphviz(**kwargs).view()

    def _repr_mimebundle_(self, include=None, exclude=None):
        try:
            return self.to_graphviz()._repr_mimebundle_(include=include, exclude=exclude)
        except Exception:
            return None

    def _repr_svg_(self):
        try:
            return self.to_graphviz()._repr_svg_()
        except Exception:
            return None


def ocpn_to_graphviz(
    ocpn: dict,
    ot_colors: Optional[Dict[str, str]] = None,
    rankdir: str = "LR",
) -> graphviz.Digraph:
    """Build a Graphviz Digraph for an Object-Centric Petri Net dictionary."""
    name = ocpn.get("name") or "OCPN"
    G = graphviz.Digraph(
        name=name,
        graph_attr={
            "rankdir": rankdir,
            "fontname": GV_FONT,
            "fontsize": "10",
            "compound": "true",
            "overlap": "false",
            "margin": "0.1,0.1",
        },
        node_attr={"fontname": GV_FONT, "fontsize": GV_FONTSIZE_NODE},
        edge_attr={"fontname": GV_FONT, "fontsize": GV_FONTSIZE_EDGE},
    )

    # Resolve object types and colors
    declared_ots = [ot["name"] for ot in ocpn.get("objectTypes", []) if isinstance(ot, dict) and "name" in ot]
    if not declared_ots:
        declared_ots = list({p.get("objectType", "") for p in ocpn.get("places", []) if p.get("objectType")})

    colors = dict(ot_colors or {})
    for ot, col in get_object_type_colors(declared_ots).items():
        colors.setdefault(ot, col)

    # Places
    place_ot_map: Dict[str, str] = {}
    for place in ocpn.get("places", []):
        pid = str(place["id"])
        ot = place.get("objectType", "")
        place_ot_map[pid] = ot
        col = colors.get(ot, "#4E79A7")

        is_init = place.get("initial", False)
        is_final = place.get("final", False)
        peripheries = "2" if (is_init or is_final) else "1"

        G.node(
            pid,
            label="",
            shape="circle",
            peripheries=peripheries,
            style="filled",
            color=col,
            fillcolor="#F8FAFC",
            fixedsize="true",
            width="0.32",
            height="0.32",
            tooltip=f"{pid} ({ot})",
        )

    # Transitions
    for trans in ocpn.get("transitions", []):
        tid = str(trans["id"])
        silent = trans.get("silent", False)
        label = trans.get("label")

        if silent or not label:
            G.node(
                tid,
                label="",
                shape="box",
                style="filled",
                color="#333333",
                fillcolor="#333333",
                fixedsize="true",
                width="0.15",
                height="0.38",
                tooltip=f"Silent transition {tid}",
            )
        else:
            G.node(
                tid,
                label=str(label),
                shape="box",
                style="rounded,filled",
                color="#555555",
                fillcolor="#FFFFFF",
            )

    # Arcs
    for arc in ocpn.get("arcs", []):
        src = str(arc["source"])
        tgt = str(arc["target"])
        is_variable = arc.get("variable", False)
        arc_style = "dashed" if is_variable else "solid"

        # Color the arc by its place's object type if possible
        ot = place_ot_map.get(src) or place_ot_map.get(tgt) or ""
        edge_col = colors.get(ot, "#333333")

        G.edge(
            src,
            tgt,
            style=arc_style,
            color=edge_col,
            arrowhead="vee",
            penwidth="1.2",
            tooltip=f"{src} -> {tgt} ({'variable' if is_variable else 'normal'})",
        )

    return G


def accepting_petri_net_to_graphviz(
    net: Any,
    rankdir: str = "LR",
) -> graphviz.Digraph:
    """Build a Graphviz Digraph for an AcceptingPetriNet."""
    G = graphviz.Digraph(
        name="AcceptingPetriNet",
        graph_attr={
            "rankdir": rankdir,
            "fontname": GV_FONT,
            "fontsize": "10",
            "overlap": "false",
            "margin": "0.1,0.1",
        },
        node_attr={"fontname": GV_FONT, "fontsize": GV_FONTSIZE_NODE},
        edge_attr={"fontname": GV_FONT, "fontsize": GV_FONTSIZE_EDGE},
    )

    source = getattr(net, "source", "")
    sink = getattr(net, "sink", "")

    for pid in getattr(net, "places", []):
        is_init = pid == source
        is_final = pid == sink
        peripheries = "2" if (is_init or is_final) else "1"
        G.node(
            str(pid),
            label="",
            shape="circle",
            peripheries=peripheries,
            style="filled",
            color="#4E79A7",
            fillcolor="#F8FAFC",
            fixedsize="true",
            width="0.32",
            height="0.32",
        )

    for tid, label in getattr(net, "transitions", {}).items():
        if label is None:
            G.node(
                str(tid),
                label="",
                shape="box",
                style="filled",
                color="#333333",
                fillcolor="#333333",
                fixedsize="true",
                width="0.15",
                height="0.38",
            )
        else:
            G.node(
                str(tid),
                label=str(label),
                shape="box",
                style="rounded,filled",
                color="#555555",
                fillcolor="#FFFFFF",
            )

    for src, tgt in sorted(getattr(net, "arcs", ())):
        G.edge(str(src), str(tgt), arrowhead="vee")

    return G


def totem_to_graphviz(
    totem: Any,
    ot_to_hex_color: Optional[dict] = None,
) -> graphviz.Digraph:
    """Build a Graphviz Digraph for a Totem model."""
    nodes = totem.tempgraph.get("nodes", set())
    colors = dict(ot_to_hex_color or {})
    for ot, col in get_object_type_colors(list(nodes)).items():
        colors.setdefault(ot, col)

    edges = {}
    for relation_type, relation_set in totem.tempgraph.items():
        if relation_type == "nodes":
            continue
        if isinstance(relation_set, set):
            for ot_a, ot_b in relation_set:
                edges[(ot_a, ot_b)] = {"TR": relation_type}

    tr_arrowhead = {
        "D": "box",
        "Di": "obox",
        "I": "normal",
        "Ii": "onormal",
        "P": "teetee",
        None: "none",
    }

    G = graphviz.Digraph(
        name="TOTeM",
        graph_attr={
            "fontname": GV_FONT,
            "fontsize": "10",
            "margin": "0.1,0.1",
            "overlap": "false",
            "rankdir": "LR",
        },
    )

    for ot in nodes:
        col = colors.get(ot, "#000000")
        G.node(
            ot,
            label=ot,
            shape="box",
            style="rounded,filled",
            fontname=GV_FONT,
            fontsize=GV_FONTSIZE_NODE,
            color=col,
            fillcolor="#FFFFFF",
        )

    for (ot_a, ot_b), edge_dict in edges.items():
        tr_relation = edge_dict.get("TR")
        card_info = totem.cardinalities.get((ot_a, ot_b), {})
        lc = card_info.get("LC", "")
        ec = card_info.get("EC", "")
        edge_label = f"{lc}\n({ec})"
        arrowhead = tr_arrowhead.get(tr_relation, "none")

        G.edge(
            ot_a,
            ot_b,
            label=edge_label,
            fontname=GV_FONT,
            fontsize=GV_FONTSIZE_EDGE,
            arrowhead=arrowhead,
            arrowtail="none",
            dir="both",
            decorate="false",
        )

    return G


def occn_to_graphviz(
    occn: Any,
    ot_colors: Optional[dict] = None,
    rankdir: str = "LR",
) -> graphviz.Digraph:
    """Build a Graphviz Digraph for an OCCausalNet model."""
    G = graphviz.Digraph(
        name="OCCN",
        graph_attr={
            "rankdir": rankdir,
            "fontname": GV_FONT,
            "fontsize": "10",
            "overlap": "false",
            "margin": "0.1,0.1",
        },
        node_attr={"fontname": GV_FONT, "fontsize": GV_FONTSIZE_NODE},
        edge_attr={"fontname": GV_FONT, "fontsize": GV_FONTSIZE_EDGE},
    )

    declared_ots = list(occn.object_types) if hasattr(occn, "object_types") else []
    colors = dict(ot_colors or {})
    for ot, col in get_object_type_colors(declared_ots).items():
        colors.setdefault(ot, col)

    # Activities
    for act in occn.activities:
        act_str = str(act)
        if act_str.startswith("START_"):
            ot_name = act_str.replace("START_", "")
            col = colors.get(ot_name, "#4E79A7")
            G.node(
                act_str,
                label=act_str,
                shape="circle",
                style="filled",
                color=col,
                fillcolor="#F8FAFC",
                fontsize="9",
            )
        elif act_str.startswith("END_"):
            ot_name = act_str.replace("END_", "")
            col = colors.get(ot_name, "#E15759")
            G.node(
                act_str,
                label=act_str,
                shape="doublecircle",
                style="filled",
                color=col,
                fillcolor="#F8FAFC",
                fontsize="9",
            )
        else:
            G.node(
                act_str,
                label=act_str,
                shape="box",
                style="rounded,filled",
                color="#555555",
                fillcolor="#FFFFFF",
            )

    # Dependency graph edges
    dep_graph = occn.dependency_graph
    if hasattr(dep_graph, "edges"):
        for u, v, data in dep_graph.edges(data=True):
            ot = data.get("objectType", "")
            dep = data.get("dependenceMeasure")
            col = colors.get(ot, "#4E79A7")
            label = f"{ot} ({dep:.2f})" if dep is not None else ot
            G.edge(
                str(u),
                str(v),
                label=label,
                color=col,
                fontcolor=col,
                arrowhead="vee",
            )

    return G


def ocdfg_to_graphviz(
    dfg: Any,
    ot_colors: Optional[dict] = None,
    rankdir: str = "LR",
) -> graphviz.Digraph:
    """Build a Graphviz Digraph for an OCDFG or CCDFG."""
    G = graphviz.Digraph(
        name="OCDFG",
        graph_attr={
            "rankdir": rankdir,
            "fontname": GV_FONT,
            "fontsize": "10",
            "overlap": "false",
            "margin": "0.1,0.1",
        },
        node_attr={"fontname": GV_FONT, "fontsize": GV_FONTSIZE_NODE},
        edge_attr={"fontname": GV_FONT, "fontsize": GV_FONTSIZE_EDGE},
    )

    # Collect object types
    ots = set()
    for _, _, data in dfg.edges(data=True):
        if "weights" in data:
            ots.update(data["weights"].keys())
        if "owners" in data:
            ots.update(data["owners"])

    colors = dict(ot_colors or {})
    for ot, col in get_object_type_colors(list(ots)).items():
        colors.setdefault(ot, col)

    # Nodes
    for node, data in dfg.nodes(data=True):
        label = data.get("label", str(node))
        node_str = str(node)
        if node_str.startswith("START_"):
            G.node(node_str, label=label, shape="circle", style="filled", color="#4E79A7", fillcolor="#F8FAFC", fontsize="9")
        elif node_str.startswith("END_"):
            G.node(node_str, label=label, shape="doublecircle", style="filled", color="#E15759", fillcolor="#F8FAFC", fontsize="9")
        else:
            G.node(node_str, label=label, shape="box", style="rounded,filled", color="#555555", fillcolor="#FFFFFF")

    # Edges
    for u, v, data in dfg.edges(data=True):
        weights = data.get("weights", {})
        weight = data.get("weight", sum(weights.values()) if weights else 1)
        if weights and len(weights) == 1:
            ot, cnt = next(iter(weights.items()))
            col = colors.get(ot, "#333333")
            label = f"{ot}: {cnt}"
        elif weights:
            col = "#333333"
            breakdown = ", ".join(f"{ot}:{cnt}" for ot, cnt in sorted(weights.items()))
            label = f"{weight} ({breakdown})"
        else:
            col = "#333333"
            label = str(weight)

        G.edge(str(u), str(v), label=label, color=col, fontcolor=col, arrowhead="vee")

    return G


def process_areas_to_graphviz(
    process_areas: dict,
    rankdir: str = "TB",
) -> graphviz.Digraph:
    """Build a Graphviz Digraph for a process areas hierarchy {level: [([ot], {activities})]}.
    
    Rendered hierarchically with levels stacked from top to bottom.
    """
    G = graphviz.Digraph(
        name="ProcessAreas",
        graph_attr={
            "rankdir": rankdir,
            "fontname": GV_FONT,
            "fontsize": "10",
            "compound": "true",
            "margin": "0.1,0.1",
        },
        node_attr={"fontname": GV_FONT, "fontsize": GV_FONTSIZE_NODE},
    )

    # Stack highest level first (resources on top)
    for level in sorted(process_areas.keys(), reverse=True):
        with G.subgraph(name=f"cluster_level_{level}") as sub:
            sub.attr(
                label=f"Level {level}",
                style="rounded,dashed",
                color="#76B7B2",
                bgcolor="#F8FAFC",
                fontname=GV_FONT,
                fontsize="11",
            )
            areas = process_areas[level]
            for i, (object_types, event_types) in enumerate(areas):
                node_id = f"pa_{level}_{i}"
                ots_str = ", ".join(sorted(object_types))
                acts_list = sorted(event_types)
                if len(acts_list) > 6:
                    acts_str = ", ".join(acts_list[:6]) + f" ... (+{len(acts_list) - 6} more)"
                else:
                    acts_str = ", ".join(acts_list)

                label = f"{ots_str}\n({len(event_types)} activities: {acts_str})"
                sub.node(
                    node_id,
                    label=label,
                    shape="box",
                    style="rounded,filled",
                    fillcolor="#FFFFFF",
                    color="#4E79A7",
                )

    return G


class ProcessAreas(dict, VisualizableMixin):
    """Process areas hierarchy dictionary with Graphviz visualization.

    Inherits from dict for 100% backward compatibility with dictionary access,
    while providing .plot(), .view(), and .to_graphviz().
    """

    def to_graphviz(self, **kwargs) -> graphviz.Digraph:
        return process_areas_to_graphviz(self, **kwargs)


def plot(model: Any, **kwargs) -> graphviz.Digraph:
    """Plot / render any supported totem_lib model using Graphviz.
    
    Works with:
    - OCPN (Object-Centric Petri Net model dictionary or OCPN instance)
    - OCCausalNet (OCCN instance)
    - Totem (Totem instance)
    - OCDFG / CCDFG (NetworkX graph instances)
    - ProcessAreas (Process area dictionary or ProcessAreas instance)
    """
    if hasattr(model, "to_graphviz"):
        return model.to_graphviz(**kwargs)

    # Check if model has a native plot method (e.g. OCHANDOVER)
    if hasattr(model, "plot") and callable(getattr(model, "plot")):
        return model.plot(**kwargs)

    # Check dictionary formats
    if isinstance(model, dict):
        if model.get("format") == "ocpn" or ("places" in model and "transitions" in model):
            return ocpn_to_graphviz(model, **kwargs)
        # Check if process areas dictionary: {int_level: [([ot], {acts})]}
        if any(isinstance(k, int) for k in model.keys()):
            return process_areas_to_graphviz(model, **kwargs)

    # Check networkx graph
    if hasattr(model, "edges") and hasattr(model, "nodes"):
        return ocdfg_to_graphviz(model, **kwargs)

    raise TypeError(
        f"Cannot plot model of type {type(model)}. Expected OCPN, OCCausalNet, Totem, OCDFG, or ProcessAreas."
    )


def to_graphviz(model: Any, **kwargs) -> graphviz.Digraph:
    """Convert any supported totem_lib model to a Graphviz Digraph. Alias for plot()."""
    return plot(model, **kwargs)
