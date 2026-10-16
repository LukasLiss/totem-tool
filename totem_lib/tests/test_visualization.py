"""Tests for model visualizers and Graphviz plotting in totem_lib."""

import graphviz
import pytest

from totem_lib import (
    OCDFG,
    OCPN,
    ProcessAreas,
    plot,
    to_graphviz,
)
from totem_lib.ocpn import AcceptingPetriNet
from totem_lib.visualization import (
    ocdfg_to_graphviz,
    ocpn_to_graphviz,
    process_areas_to_graphviz,
    totem_to_graphviz,
)


def test_ocpn_visualization():
    sample_ocpn = OCPN({
        "format": "ocpn",
        "version": 1,
        "name": "Test OCPN",
        "objectTypes": [{"name": "order"}, {"name": "item"}],
        "places": [
            {"id": "p1", "objectType": "order", "initial": True},
            {"id": "p2", "objectType": "order", "final": True},
            {"id": "p3", "objectType": "item", "initial": True},
        ],
        "transitions": [
            {"id": "t1", "label": "create_order"},
            {"id": "t2", "silent": True},
        ],
        "arcs": [
            {"id": "a1", "source": "p1", "target": "t1", "variable": False},
            {"id": "a2", "source": "t1", "target": "p2", "variable": True},
            {"id": "a3", "source": "p3", "target": "t2", "variable": False},
        ],
    })

    # Test .plot() and .to_graphviz()
    g = sample_ocpn.plot()
    assert isinstance(g, graphviz.Digraph)
    dot_str = g.source
    assert "p1" in dot_str
    assert "p2" in dot_str
    assert "create_order" in dot_str
    assert "dashed" in dot_str  # variable arc

    # Universal dispatchers
    assert isinstance(plot(sample_ocpn), graphviz.Digraph)
    assert isinstance(to_graphviz(sample_ocpn), graphviz.Digraph)

    # Plain dict dispatch
    plain_dict = dict(sample_ocpn)
    assert isinstance(plot(plain_dict), graphviz.Digraph)


def test_accepting_petri_net_visualization():
    net = AcceptingPetriNet(
        places=["p0", "p1"],
        transitions={"t0": "check", "t1": None},
        arcs={("p0", "t0"), ("t0", "p1"), ("p1", "t1")},
        source="p0",
        sink="p1",
    )
    g = net.plot()
    assert isinstance(g, graphviz.Digraph)
    assert "p0" in g.source
    assert "check" in g.source
    assert isinstance(plot(net), graphviz.Digraph)



def test_totem_visualization():
    class DummyTotem:
        def __init__(self):
            self.tempgraph = {
                "nodes": {"order", "item"},
                "D": {("order", "item")},
                "P": set(),
            }
            self.cardinalities = {
                ("order", "item"): {"LC": "1..*", "EC": "1"},
            }

    dummy = DummyTotem()
    g = totem_to_graphviz(dummy)
    assert isinstance(g, graphviz.Digraph)
    dot_str = g.source
    assert "order" in dot_str
    assert "item" in dot_str
    assert "1..*" in dot_str


def test_process_areas_visualization():
    pa = ProcessAreas({
        0: [(["order"], {"create_order", "pay_order"})],
        1: [(["item", "package"], {"pick_item", "pack_item"})],
    })

    g = pa.plot()
    assert isinstance(g, graphviz.Digraph)
    dot_str = g.source
    assert "cluster_level_0" in dot_str
    assert "cluster_level_1" in dot_str
    assert "order" in dot_str
    assert "create_order" in dot_str

    # Universal dispatcher
    assert isinstance(plot(pa), graphviz.Digraph)
    assert isinstance(plot(dict(pa)), graphviz.Digraph)


def test_ocdfg_visualization():
    import networkx as nx

    dfg = OCDFG()
    dfg.add_node("A", label="Activity A")
    dfg.add_node("B", label="Activity B")
    dfg.add_edge("A", "B", weight=42, weights={"order": 42}, owners={"order"})

    g = dfg.plot()
    assert isinstance(g, graphviz.Digraph)
    dot_str = g.source
    assert "Activity A" in dot_str
    assert "Activity B" in dot_str
    assert "order: 42" in dot_str

    # Universal dispatcher
    assert isinstance(plot(dfg), graphviz.Digraph)


def test_totem_plot_accepts_colors_and_kwargs():
    from totem_lib import Totem

    totem = Totem.__new__(Totem)
    totem.tempgraph = {"nodes": {"order", "item"}, "D": {("order", "item")}}
    totem.cardinalities = {("order", "item"): {"LC": "1", "EC": "1"}}

    g = totem.plot(ot_colors={"order": "#123456"}, rankdir="TB")
    assert "#123456" in g.source
    assert "rankdir=TB" in g.source
    assert "#123456" in plot(totem, ot_colors={"order": "#123456"}).source
    # Legacy keyword still honored
    assert "#654321" in totem_to_graphviz(totem, ot_to_hex_color={"order": "#654321"}).source


def test_process_areas_labels_are_html_escaped():
    pa = ProcessAreas({0: [(["R&D <team>"], {"Check & Approve", "a<b"})]})
    dot_str = pa.to_graphviz().source
    assert "R&amp;D &lt;team&gt;" in dot_str
    assert "Check &amp; Approve" in dot_str
    assert "a&lt;b" in dot_str
    assert "Check & Approve" not in dot_str


def test_unsupported_model_raises():
    with pytest.raises(TypeError):
        plot("not a model")
