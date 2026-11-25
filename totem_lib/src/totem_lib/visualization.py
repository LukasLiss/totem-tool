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

import html
import math
import os
import shutil
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

GV_FONT = "Segoe UI, Roboto, Helvetica, Arial, sans-serif"
GV_FONTSIZE_NODE = "10"
GV_FONTSIZE_EDGE = "9"


def _ensure_graphviz_on_path() -> None:
    """Proactively ensures Graphviz 'dot' executable is on PATH.

    If 'dot' is not already on PATH (e.g. portable extraction on Windows),
    searches standard installation and portable locations and prepends them.
    """
    if shutil.which("dot") is not None:
        return

    candidates = [
        Path.home() / "graphviz" / "bin",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Graphviz" / "bin",
        Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Graphviz" / "bin",
        Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "Graphviz" / "bin",
    ]
    try:
        user_home = Path.home()
        for p in user_home.glob("graphviz/*/bin"):
            candidates.append(p)
    except Exception:
        pass

    for candidate in candidates:
        if candidate.exists() and ((candidate / "dot.exe").exists() or (candidate / "dot").exists()):
            os.environ["PATH"] = str(candidate) + os.pathsep + os.environ.get("PATH", "")
            return


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
        _ensure_graphviz_on_path()
        return self.to_graphviz(**kwargs)

    def view(self, **kwargs) -> Any:
        """Open the rendered model with the system default viewer."""
        _ensure_graphviz_on_path()
        return self.to_graphviz(**kwargs).view()

    def _repr_mimebundle_(self, include=None, exclude=None):
        try:
            _ensure_graphviz_on_path()
            return self.to_graphviz()._repr_mimebundle_(include=include, exclude=exclude)
        except Exception:
            return None

    def _repr_svg_(self):
        try:
            _ensure_graphviz_on_path()
            return self.to_graphviz()._repr_svg_()
        except Exception:
            return None


def ocpn_to_graphviz(
    ocpn: dict,
    ot_colors: Optional[Dict[str, str]] = None,
    rankdir: str = "LR",
) -> graphviz.Digraph:
    """Build a Graphviz Digraph for an Object-Centric Petri Net dictionary."""
    _ensure_graphviz_on_path()
    name = ocpn.get("name") or "OCPN"
    G = graphviz.Digraph(
        name=name,
        graph_attr={
            "rankdir": rankdir,
            "fontname": GV_FONT,
            "fontsize": "10",
            "compound": "true",
            "overlap": "false",
            "splines": "spline",
            "nodesep": "0.3",
            "ranksep": "0.55",
            "pad": "0.2",
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

    # Compute place degree for clean source/sink rank pinning
    place_in: Dict[str, int] = {}
    place_out: Dict[str, int] = {}
    for arc in ocpn.get("arcs", []):
        place_out[str(arc["source"])] = place_out.get(str(arc["source"]), 0) + 1
        place_in[str(arc["target"])] = place_in.get(str(arc["target"]), 0) + 1

    source_places: List[str] = []
    sink_places: List[str] = []
    place_ot_map: Dict[str, str] = {}

    for place in ocpn.get("places", []):
        pid = str(place["id"])
        ot = place.get("objectType", "")
        place_ot_map[pid] = ot
        col = colors.get(ot, "#4E79A7")

        is_init = place.get("initial", False)
        is_final = place.get("final", False)
        in_deg = place_in.get(pid, 0)
        out_deg = place_out.get(pid, 0)

        if is_init and in_deg == 0:
            source_places.append(pid)
        if is_final and out_deg == 0:
            sink_places.append(pid)

        peripheries = "2" if (is_init or is_final) else "1"
        lbl = "●" if (is_init and in_deg == 0) else ""

        G.node(
            pid,
            label=lbl,
            shape="circle",
            peripheries=peripheries,
            style="filled",
            color=col,
            fillcolor="#FFFFFF",
            fontcolor=col,
            fontsize="12",
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
                color="#1E293B",
                fillcolor="#1E293B",
                fixedsize="true",
                width="0.14",
                height="0.36",
                tooltip=f"Silent transition {tid}",
            )
        else:
            G.node(
                tid,
                label=str(label),
                shape="box",
                style="rounded,filled",
                color="#475569",
                fillcolor="#F8FAFC",
                fontcolor="#0F172A",
                penwidth="1.2",
                margin="0.1,0.06",
            )

    # Align pure sources and sinks
    if source_places:
        with G.subgraph() as s:
            s.attr(rank="source")
            for p in source_places:
                s.node(p)

    if sink_places:
        with G.subgraph() as s:
            s.attr(rank="sink")
            for p in sink_places:
                s.node(p)

    # Arcs
    for arc in ocpn.get("arcs", []):
        src = str(arc["source"])
        tgt = str(arc["target"])
        is_variable = arc.get("variable", False)
        arc_style = "dashed" if is_variable else "solid"

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
    _ensure_graphviz_on_path()
    G = graphviz.Digraph(
        name="AcceptingPetriNet",
        graph_attr={
            "rankdir": rankdir,
            "fontname": GV_FONT,
            "fontsize": "10",
            "overlap": "false",
            "splines": "spline",
            "nodesep": "0.3",
            "ranksep": "0.55",
            "pad": "0.2",
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
        lbl = "●" if is_init else ""
        G.node(
            str(pid),
            label=lbl,
            shape="circle",
            peripheries=peripheries,
            style="filled",
            color="#4E79A7",
            fillcolor="#FFFFFF",
            fontcolor="#4E79A7",
            fontsize="12",
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
                color="#1E293B",
                fillcolor="#1E293B",
                fixedsize="true",
                width="0.14",
                height="0.36",
            )
        else:
            G.node(
                str(tid),
                label=str(label),
                shape="box",
                style="rounded,filled",
                color="#475569",
                fillcolor="#F8FAFC",
                fontcolor="#0F172A",
                penwidth="1.2",
                margin="0.1,0.06",
            )

    if source:
        with G.subgraph() as s:
            s.attr(rank="source")
            s.node(str(source))

    if sink:
        with G.subgraph() as s:
            s.attr(rank="sink")
            s.node(str(sink))

    for src, tgt in sorted(getattr(net, "arcs", ())):
        G.edge(str(src), str(tgt), arrowhead="vee", penwidth="1.2", color="#4E79A7")

    return G


def totem_to_graphviz(
    totem: Any,
    ot_colors: Optional[dict] = None,
    rankdir: str = "LR",
    ot_to_hex_color: Optional[dict] = None,
) -> graphviz.Digraph:
    """Build a Graphviz Digraph for a Totem model.

    ``ot_to_hex_color`` is a legacy alias for ``ot_colors``.
    """
    _ensure_graphviz_on_path()
    nodes = totem.tempgraph.get("nodes", set())
    colors = dict(ot_colors or ot_to_hex_color or {})
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
            "margin": "0.15,0.15",
            "nodesep": "0.4",
            "ranksep": "0.7",
            "splines": "spline",
            "rankdir": rankdir,
        },
        node_attr={"fontname": GV_FONT, "fontsize": "10"},
        edge_attr={"fontname": GV_FONT, "fontsize": "9"},
    )

    for ot in sorted(nodes):
        col = colors.get(ot, "#334155")
        G.node(
            ot,
            label=ot,
            shape="box",
            style="rounded,filled",
            color=col,
            fillcolor="#FFFFFF",
            fontcolor="#0F172A",
            penwidth="2.0",
            margin="0.15,0.1",
        )

    for (ot_a, ot_b), edge_dict in sorted(edges.items()):
        tr_relation = edge_dict.get("TR")
        card_info = totem.cardinalities.get((ot_a, ot_b), {})
        lc = card_info.get("LC", "").replace("...", "..")
        ec = card_info.get("EC", "").replace("...", "..")
        edge_label = f"{lc}\n({ec})"
        arrowhead = tr_arrowhead.get(tr_relation, "none")

        G.edge(
            ot_a,
            ot_b,
            label=edge_label,
            fontcolor="#1E293B",
            color="#475569",
            penwidth="1.2",
            arrowhead=arrowhead,
            arrowsize="0.9",
            dir="forward",
        )

    return G


def occn_to_graphviz(
    occn: Any,
    ot_colors: Optional[dict] = None,
    rankdir: str = "LR",
) -> graphviz.Digraph:
    """Build a Graphviz Digraph for an OCCausalNet model."""
    _ensure_graphviz_on_path()
    G = graphviz.Digraph(
        name="OCCN",
        graph_attr={
            "rankdir": rankdir,
            "fontname": GV_FONT,
            "fontsize": "10",
            "overlap": "false",
            "splines": "spline",
            "nodesep": "0.35",
            "ranksep": "0.6",
            "margin": "0.1,0.1",
        },
        node_attr={"fontname": GV_FONT, "fontsize": GV_FONTSIZE_NODE},
        edge_attr={"fontname": GV_FONT, "fontsize": GV_FONTSIZE_EDGE},
    )

    declared_ots = list(occn.object_types) if hasattr(occn, "object_types") else []
    colors = dict(ot_colors or {})
    for ot, col in get_object_type_colors(declared_ots).items():
        colors.setdefault(ot, col)

    start_nodes: List[str] = []
    end_nodes: List[str] = []

    # Activities
    for act in occn.activities:
        act_str = str(act)
        if act_str.startswith("START_"):
            ot_name = act_str.replace("START_", "")
            col = colors.get(ot_name, "#2E7D32")
            start_nodes.append(act_str)
            G.node(
                act_str,
                label=f"▶ {ot_name}",
                shape="box",
                style="rounded,filled",
                color=col,
                fillcolor="#F0FDF4",
                fontcolor="#166534",
                fontsize="9",
                penwidth="1.5",
                margin="0.1,0.06",
            )
        elif act_str.startswith("END_"):
            ot_name = act_str.replace("END_", "")
            col = colors.get(ot_name, "#DC2626")
            end_nodes.append(act_str)
            G.node(
                act_str,
                label=f"■ {ot_name}",
                shape="box",
                style="rounded,filled",
                color=col,
                fillcolor="#FEF2F2",
                fontcolor="#991B1B",
                fontsize="9",
                penwidth="1.5",
                margin="0.1,0.06",
            )
        else:
            cnt = getattr(occn, "activity_count", {}).get(act_str)
            lbl = f"{act_str}\n(x{cnt})" if cnt else act_str
            G.node(
                act_str,
                label=lbl,
                shape="box",
                style="rounded,filled",
                color="#475569",
                fillcolor="#F8FAFC",
                fontcolor="#1E293B",
                penwidth="1.2",
                margin="0.1,0.06",
            )

    # Constrain start and end nodes to opposite ranks
    if start_nodes:
        with G.subgraph() as s:
            s.attr(rank="source")
            for sn in start_nodes:
                s.node(sn)

    if end_nodes:
        with G.subgraph() as s:
            s.attr(rank="sink")
            for en in end_nodes:
                s.node(en)

    # Dependency graph edges
    dep_graph = occn.dependency_graph
    if hasattr(dep_graph, "edges"):
        for u, v, data in dep_graph.edges(data=True):
            ot = data.get("objectType", "")
            dep = data.get("dependenceMeasure")
            col = colors.get(ot, "#4E79A7")
            label = f"{ot} ({dep:.2f})" if dep is not None else ot
            pw = "1.8" if (dep is not None and dep >= 0.8) else "1.0"
            G.edge(
                str(u),
                str(v),
                label=label,
                color=col,
                fontcolor=col,
                arrowhead="vee",
                penwidth=pw,
            )

    return G


def _sanitize_dfg_node_id(node: Any) -> str:
    """Sanitize node IDs to prevent Graphviz from treating colons ':' as port delimiters."""
    return str(node).replace(":", "___")


def ocdfg_to_graphviz(
    dfg: Any,
    ot_colors: Optional[dict] = None,
    rankdir: str = "LR",
) -> graphviz.Digraph:
    """Build a Graphviz Digraph for an OCDFG or CCDFG."""
    _ensure_graphviz_on_path()
    G = graphviz.Digraph(
        name="OCDFG",
        graph_attr={
            "rankdir": rankdir,
            "fontname": GV_FONT,
            "fontsize": "10",
            "overlap": "false",
            "splines": "spline",
            "nodesep": "0.35",
            "ranksep": "0.6",
            "margin": "0.1,0.1",
        },
        node_attr={"fontname": GV_FONT, "fontsize": "9"},
        edge_attr={"fontname": GV_FONT, "fontsize": "8"},
    )

    # Collect object types
    ots: Set[str] = set()
    for _, _, data in dfg.edges(data=True):
        if "weights" in data:
            ots.update(data["weights"].keys())
        if "owners" in data:
            ots.update(data["owners"])

    colors = dict(ot_colors or {})
    for ot, col in get_object_type_colors(list(ots)).items():
        colors.setdefault(ot, col)

    start_nodes: List[str] = []
    end_nodes: List[str] = []

    # Nodes
    for node, data in dfg.nodes(data=True):
        node_str = str(node)
        nid = _sanitize_dfg_node_id(node)
        is_start = node_str.startswith("__start__") or node_str.startswith("START_") or data.get("role") == "start"
        is_end = node_str.startswith("__end__") or node_str.startswith("END_") or data.get("role") == "end"

        if is_start:
            start_nodes.append(nid)
            ot = data.get("object_type") or (
                node_str.split(":", 1)[1] if ":" in node_str else node_str.replace("START_", "")
            )
            col = colors.get(ot, "#198754")
            G.node(
                nid,
                label=f"{ot}\nstart",
                shape="circle",
                style="filled",
                color=col,
                fillcolor="#E8F5E9",
                fontcolor="#1B5E20",
                fontsize="8",
                margin="0.05,0.05",
            )
        elif is_end:
            end_nodes.append(nid)
            ot = data.get("object_type") or (
                node_str.split(":", 1)[1] if ":" in node_str else node_str.replace("END_", "")
            )
            col = colors.get(ot, "#DC3545")
            G.node(
                nid,
                label=f"{ot}\nend",
                shape="doublecircle",
                style="filled",
                color=col,
                fillcolor="#FFEBEE",
                fontcolor="#B71C1C",
                fontsize="8",
                margin="0.05,0.05",
            )
        else:
            label = data.get("label", node_str)
            count = data.get("count")
            lbl = f"{label}\n({count})" if count else label
            G.node(
                nid,
                label=lbl,
                shape="box",
                style="rounded,filled",
                color="#455A64",
                fillcolor="#ECEFF1",
                fontcolor="#263238",
                penwidth="1.2",
                margin="0.1,0.06",
            )

    # Align start and end nodes on respective ranks
    if start_nodes:
        with G.subgraph() as s:
            s.attr(rank="source")
            for sn in start_nodes:
                s.node(sn)

    if end_nodes:
        with G.subgraph() as s:
            s.attr(rank="sink")
            for en in end_nodes:
                s.node(en)

    # Edges
    for u, v, data in dfg.edges(data=True):
        weights = data.get("weights", {})
        weight = data.get("weight", sum(weights.values()) if weights else 1)
        if weights and len(weights) == 1:
            ot, cnt = next(iter(weights.items()))
            col = colors.get(ot, "#333333")
            label = f"{ot}: {cnt}"
        elif weights:
            col = "#455A64"
            breakdown = ", ".join(f"{ot}:{cnt}" for ot, cnt in sorted(weights.items()))
            label = f"{weight} ({breakdown})"
        else:
            col = "#455A64"
            label = str(weight)

        pw = str(round(max(1.0, min(3.5, 1.0 + 0.5 * math.log10(max(1, weight)))), 2))
        G.edge(
            _sanitize_dfg_node_id(u),
            _sanitize_dfg_node_id(v),
            label=label,
            color=col,
            fontcolor=col,
            penwidth=pw,
            arrowhead="vee",
        )

    return G


def process_areas_to_graphviz(
    process_areas: dict,
    rankdir: str = "TB",
) -> graphviz.Digraph:
    """Build a Graphviz Digraph for a process areas hierarchy {level: [([ot], {activities})]}.

    Rendered hierarchically with levels stacked vertically from highest level to lowest.
    """
    _ensure_graphviz_on_path()
    G = graphviz.Digraph(
        name="ProcessAreas",
        graph_attr={
            "rankdir": rankdir,
            "fontname": GV_FONT,
            "fontsize": "11",
            "compound": "true",
            "margin": "0.15,0.15",
            "nodesep": "0.3",
            "ranksep": "0.4",
            "splines": "true",
        },
        node_attr={"fontname": GV_FONT, "fontsize": "9"},
        edge_attr={"fontname": GV_FONT, "fontsize": "8"},
    )

    sorted_levels = sorted(process_areas.keys(), reverse=True)
    level_rep_nodes: List[Tuple[str, str]] = []

    for level in sorted_levels:
        lvl_str = str(int(level)) if level == int(level) else str(level)
        cluster_name = f"cluster_level_{lvl_str}"
        with G.subgraph(name=cluster_name) as sub:
            sub.attr(
                label=f"Level {lvl_str}",
                style="rounded,filled",
                color="#94A3B8",
                bgcolor="#F8FAFC",
                fontname=GV_FONT,
                fontsize="11",
                fontcolor="#334155",
                margin="12",
            )
            areas = process_areas[level]
            rep_id = None
            for i, (object_types, event_types) in enumerate(areas):
                node_id = f"pa_{lvl_str}_{i}"
                if rep_id is None:
                    rep_id = node_id

                # Names are user data; escape them for Graphviz HTML-like labels.
                ots_str = html.escape(", ".join(sorted(object_types)))
                acts_list = [html.escape(str(a)) for a in sorted(event_types)]

                if acts_list:
                    chunks = [", ".join(acts_list[j : j + 3]) for j in range(0, min(len(acts_list), 9), 3)]
                    if len(acts_list) > 9:
                        chunks.append(f"... (+{len(acts_list) - 9} more activities)")
                    acts_formatted = "<BR/>".join(chunks)
                    label = (
                        f'<<TABLE BORDER="0" CELLBORDER="0" CELLSPACING="2">'
                        f'<TR><TD><B><FONT POINT-SIZE="10" COLOR="#1E293B">{ots_str}</FONT></B></TD></TR>'
                        f'<TR><TD><FONT POINT-SIZE="8" COLOR="#64748B">{len(event_types)} Activities:</FONT></TD></TR>'
                        f'<TR><TD><FONT POINT-SIZE="8" COLOR="#334155">{acts_formatted}</FONT></TD></TR>'
                        f"</TABLE>>"
                    )
                else:
                    label = (
                        f'<<TABLE BORDER="0" CELLBORDER="0" CELLSPACING="2">'
                        f'<TR><TD><B><FONT POINT-SIZE="10" COLOR="#1E293B">{ots_str}</FONT></B></TD></TR>'
                        f'<TR><TD><I><FONT POINT-SIZE="8" COLOR="#94A3B8">(Shared / Coordinating Level)</FONT></I></TD></TR>'
                        f"</TABLE>>"
                    )

                sub.node(
                    node_id,
                    label=label,
                    shape="box",
                    style="rounded,filled",
                    fillcolor="#FFFFFF",
                    color="#3B82F6",
                    penwidth="1.5",
                    margin="0.1,0.08",
                )
            if rep_id:
                level_rep_nodes.append((lvl_str, rep_id))

    # Connect levels top to bottom to enforce hierarchical stacking
    for idx in range(len(level_rep_nodes) - 1):
        lvl_from, node_from = level_rep_nodes[idx]
        lvl_to, node_to = level_rep_nodes[idx + 1]
        G.edge(
            node_from,
            node_to,
            style="dashed",
            color="#94A3B8",
            arrowhead="normal",
            penwidth="1.2",
            ltail=f"cluster_level_{lvl_from}",
            lhead=f"cluster_level_{lvl_to}",
            tooltip=f"Hierarchy: Level {lvl_from} -> Level {lvl_to}",
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
    _ensure_graphviz_on_path()
    if hasattr(model, "to_graphviz"):
        return model.to_graphviz(**kwargs)

    if hasattr(model, "plot") and callable(getattr(model, "plot")):
        return model.plot(**kwargs)

    if isinstance(model, dict):
        if model.get("format") == "ocpn" or ("places" in model and "transitions" in model):
            return ocpn_to_graphviz(model, **kwargs)
        if any(isinstance(k, (int, float)) for k in model.keys()):
            return process_areas_to_graphviz(model, **kwargs)

    if hasattr(model, "edges") and hasattr(model, "nodes"):
        return ocdfg_to_graphviz(model, **kwargs)

    raise TypeError(
        f"Cannot plot model of type {type(model)}. Expected OCPN, OCCausalNet, Totem, OCDFG, or ProcessAreas."
    )


def to_graphviz(model: Any, **kwargs) -> graphviz.Digraph:
    """Convert any supported totem_lib model to a Graphviz Digraph. Alias for plot()."""
    return plot(model, **kwargs)
