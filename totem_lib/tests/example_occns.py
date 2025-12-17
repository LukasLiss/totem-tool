from totem_lib import OCCausalNet


def occn_basic():
    marker_groups = {
        "START_order": {
            "omg": [
                [("a", "order", (1, 1), 0)],
            ],
        },
        "START_item": {
            "omg": [
                [("a", "item", (1, -1), 0)],
            ],
        },
        "a": {
            "img": [
                [
                    ("START_order", "order", (1, 1), 0),
                    ("START_item", "item", (1, -1), 0),
                ],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, 1), 0),
                    ("END_item", "item", (1, -1), 0),
                ],
            ],
        },
        "END_order": {
            "img": [
                [("a", "order", (1, 1), 0)],
            ],
        },
        "END_item": {
            "img": [
                [("a", "item", (1, -1), 0)],
            ],
        },
    }

    occn = OCCausalNet.from_dict(marker_groups)
    return occn


def occn_basic_2():
    marker_groups = {
        "START_container": {
            "omg": [
                [("c", "container", (1, 1), 0), ("i", "container", (1, 1), 0)],
            ],
        },
        "c": {
            "img": [
                [("START_container", "container", (1, 1), 0)],
            ],
            "omg": [
                [("e", "container", (1, 1), 0)],
            ],
        },
        "i": {
            "img": [
                [("START_container", "container", (1, 1), 0)],
            ],
            "omg": [
                [("e", "container", (1, 1), 0)],
            ],
        },
        "e": {
            "img": [
                [("c", "container", (1, 1), 0), ("i", "container", (1, 1), 0)],
            ],
            "omg": [
                [("s", "container", (1, 1), 0)],
            ],
        },
        "START_order": {
            "omg": [
                [("a", "order", (1, 1), 0)],
                [("b", "order", (1, 1), 0)],
            ],
        },
        "a": {
            "img": [
                [("START_order", "order", (1, 1), 0)],
            ],
            "omg": [
                [("b", "order", (1, 1), 0)],
            ],
        },
        "b": {
            "img": [
                [("START_order", "order", (1, 1), 0)],
                [("a", "order", (1, 1), 0)],
            ],
            "omg": [
                [("s", "order", (1, 1), 0)],
            ],
        },
        "START_box": {
            "omg": [
                [("d", "box", (1, 1), 0)],
            ],
        },
        "d": {
            "img": [
                [("START_box", "box", (1, 1), 0)],
            ],
            "omg": [
                [("s", "box", (1, 1), 0)],
            ],
        },
        "s": {
            "img": [
                [("e", "container", (1, 1), 0), ("b", "order", (1, -1), 0)],
                [("d", "box", (1, 1), 0), ("b", "order", (1, 1), 0)],
            ],
            "omg": [
                [("END_container", "container", (1, 1), 0), ("r", "order", (1, -1), 0)],
                [("END_box", "box", (1, 1), 0), ("r", "order", (1, 1), 0)],
            ],
        },
        "END_container": {
            "img": [
                [("s", "container", (1, 1), 0)],
            ],
        },
        "END_box": {
            "img": [
                [("s", "box", (1, 1), 0)],
            ],
        },
        "r": {
            "img": [
                [("s", "order", (1, 1), 0)],
                [("s", "order", (1, -1), 0)],
            ],
            "omg": [
                [
                    ("ti", "order", (1, 1), 1),
                    ("si", "order", (0, -1), 1),
                    ("da", "order", (1, 1), 2),
                    ("ba", "order", (0, -1), 2),
                ],
            ],
        },
        "ti": {
            "img": [
                [("r", "order", (1, 1), 0)],
            ],
            "omg": [
                [("END_order", "order", (1, 1), 0)],
            ],
        },
        "si": {
            "img": [
                [("r", "order", (1, -1), 0)],
            ],
            "omg": [
                [("END_order", "order", (1, -1), 0)],
            ],
        },
        "da": {
            "img": [
                [("r", "order", (1, 1), 0)],
            ],
            "omg": [
                [("END_order", "order", (1, 1), 0)],
            ],
        },
        "ba": {
            "img": [
                [("r", "order", (1, -1), 0)],
            ],
            "omg": [
                [("END_order", "order", (1, -1), 0)],
            ],
        },
        "END_order": {
            "img": [
                [("ti", "order", (1, 1), 0)],
                [("si", "order", (1, 1), 0)],
                [("da", "order", (1, 1), 0)],
                [("ba", "order", (1, 1), 0)],
            ],
        },
    }

    occn = OCCausalNet.from_dict(marker_groups)
    return occn


def occn_basic_3():
    marker_groups = {
        "START_order": {
            "img": [],
            "omg": [
                [("a", "order", (1, 1), 0)],
            ],
        },
        "a": {
            "img": [
                [("START_order", "order", (1, 1), 0)],
            ],
            "omg": [
                [("END_order", "order", (1, 1), 0)],
            ],
        },
        "END_order": {
            "img": [
                [("a", "order", (1, 1), 0)],
            ]
        },
    }

    occn = OCCausalNet.from_dict(marker_groups)
    return occn


def occn_multi():
    marker_groups = {
        "START_order": {
            "img": [],
            "omg": [
                [("a", "order", (1, -1), 0)],
            ],
        },
        "a": {
            "img": [
                [("START_order", "order", (1, -1), 0)],
            ],
            "omg": [
                [("END_order", "order", (1, -1), 0)],
            ],
        },
        "END_order": {
            "img": [
                [("a", "order", (1, -1), 0)],
            ]
        },
    }

    occn = OCCausalNet.from_dict(marker_groups)
    return occn


def occn_combined():
    marker_groups = {
        "START_order": {
            "img": [],
            "omg": [
                [("a", "order", (1, 1), 0)],
                [("a", "order", (1, -1), 0)],
            ],
        },
        "a": {
            "img": [
                [("START_order", "order", (1, 1), 0)],
            ],
            "omg": [
                [("END_order", "order", (1, 1), 0)],
            ],
        },
        "END_order": {
            "img": [
                [("a", "order", (1, 1), 0)],
                [("a", "order", (1, -1), 0)],
            ]
        },
    }

    occn = OCCausalNet.from_dict(marker_groups)
    return occn


def occn_multi_marker():
    marker_groups = {
        "START_order": {
            "img": [],
            "omg": [
                [("a", "order", (1, -1), 0)],
            ],
        },
        "a": {
            "img": [
                [("START_order", "order", (2, 2), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, 1), 0),
                    ("b", "order", (1, 1), 0),
                ],
            ],
        },
        "b": {
            "img": [
                [("a", "order", (1, 1), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, 1), 0),
                ],
            ],
        },
        "END_order": {
            "img": [
                [("a", "order", (1, 1), 0)],
                [("b", "order", (1, 1), 0)],
            ]
        },
    }

    occn = OCCausalNet.from_dict(marker_groups)
    return occn


def occn_multi_square_marker():
    marker_groups = {
        "START_order": {
            "img": [],
            "omg": [
                [("a", "order", (1, -1), 0)],
            ],
        },
        "a": {
            "img": [
                [("START_order", "order", (1, -1), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, -1), 0),
                    ("b", "order", (1, 1), 0),
                ],
            ],
        },
        "b": {
            "img": [
                [("a", "order", (1, 1), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, 1), 0),
                ],
            ],
        },
        "END_order": {
            "img": [
                [("a", "order", (1, -1), 0), ("b", "order", (1, 1), 0)],
            ]
        },
    }

    occn = OCCausalNet.from_dict(marker_groups)
    return occn


def occn_triple_marker():
    marker_groups = {
        "START_order": {
            "img": [],
            "omg": [
                [("a", "order", (1, -1), 0)],
            ],
        },
        "a": {
            "img": [
                [("START_order", "order", (1, -1), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, -1), 0),
                    ("b", "order", (1, 1), 0),
                    ("c", "order", (1, -1), 0),
                ],
            ],
        },
        "b": {
            "img": [
                [("a", "order", (1, 1), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, 1), 0),
                ],
            ],
        },
        "c": {
            "img": [
                [("a", "order", (1, -1), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, -1), 0),
                ],
            ],
        },
        "END_order": {
            "img": [
                [
                    ("a", "order", (1, -1), 0),
                    ("b", "order", (1, 1), 0),
                    ("c", "order", (1, -1), 0),
                ],
            ]
        },
    }

    occn = OCCausalNet.from_dict(marker_groups)
    return occn


def occn_key():
    marker_groups = {
        "START_order": {
            "img": [],
            "omg": [
                [("a", "order", (1, -1), 0)],
            ],
        },
        "a": {
            "img": [
                [("START_order", "order", (1, -1), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, -1), 1),
                    ("b", "order", (1, 1), 1),
                    ("c", "order", (1, -1), 1),
                ],
            ],
        },
        "b": {
            "img": [
                [("a", "order", (1, 1), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, 1), 0),
                ],
            ],
        },
        "c": {
            "img": [
                [("a", "order", (1, -1), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, -1), 0),
                ],
            ],
        },
        "END_order": {
            "img": [
                [
                    ("a", "order", (1, -1), 0),
                    ("b", "order", (1, 1), 0),
                    ("c", "order", (1, -1), 0),
                ],
            ]
        },
    }

    occn = OCCausalNet.from_dict(marker_groups)
    return occn


def occn_key_input():
    marker_groups = {
        "START_order": {
            "img": [],
            "omg": [
                [("a", "order", (1, -1), 0)],
            ],
        },
        "a": {
            "img": [
                [("START_order", "order", (1, -1), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, -1), 1),
                    ("b", "order", (1, 1), 1),
                    ("c", "order", (1, -1), 1),
                ],
            ],
        },
        "b": {
            "img": [
                [("a", "order", (1, 1), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, 1), 0),
                ],
            ],
        },
        "c": {
            "img": [
                [("a", "order", (1, -1), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, -1), 0),
                ],
            ],
        },
        "END_order": {
            "img": [
                [
                    ("a", "order", (1, -1), 1),
                    ("b", "order", (1, 1), 1),
                    ("c", "order", (1, -1), 1),
                ],
            ]
        },
    }

    occn = OCCausalNet.from_dict(marker_groups)
    return occn


def occn_key_order():
    marker_groups = {
        "START_order": {
            "img": [],
            "omg": [
                [("a", "order", (1, -1), 0)],
            ],
        },
        "a": {
            "img": [
                [("START_order", "order", (1, -1), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, -1), 1),
                    ("b", "order", (1, 1), 0),
                    ("c", "order", (1, -1), 1),
                ],
            ],
        },
        "b": {
            "img": [
                [("a", "order", (1, 1), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, 1), 0),
                ],
            ],
        },
        "c": {
            "img": [
                [("a", "order", (1, -1), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, -1), 0),
                ],
            ],
        },
        "END_order": {
            "img": [
                [
                    ("a", "order", (1, -1), 0),
                    ("b", "order", (1, 1), 0),
                    ("c", "order", (1, -1), 0),
                ],
            ]
        },
    }

    occn = OCCausalNet.from_dict(marker_groups)
    return occn


def occn_multi_key():
    marker_groups = {
        "START_order": {
            "img": [],
            "omg": [
                [("a", "order", (1, -1), 0)],
            ],
        },
        "a": {
            "img": [
                [("START_order", "order", (1, -1), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, -1), 1),
                    ("b", "order", (1, 1), 1),
                    ("c", "order", (1, -1), 1),
                ],
                [
                    ("END_order", "order", (1, -1), 2),
                    ("b", "order", (1, 1), 2),
                ],
            ],
        },
        "b": {
            "img": [
                [("a", "order", (1, 1), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, 1), 0),
                ],
            ],
        },
        "c": {
            "img": [
                [("a", "order", (1, -1), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, -1), 0),
                ],
            ],
        },
        "END_order": {
            "img": [
                [
                    ("a", "order", (1, -1), 0),
                    ("b", "order", (1, 1), 0),
                    ("c", "order", (1, -1), 0),
                ],
            ]
        },
    }

    occn = OCCausalNet.from_dict(marker_groups)
    return occn


def occn_multi_key_2():
    marker_groups = {
        "START_order": {
            "img": [],
            "omg": [
                [("a", "order", (1, -1), 0)],
            ],
        },
        "a": {
            "img": [
                [("START_order", "order", (1, -1), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, -1), 1),
                    ("b", "order", (1, 1), 2),
                    ("c", "order", (1, -1), 1),
                    ("d", "order", (1, 1), 2),
                ],
            ],
        },
        "b": {
            "img": [
                [("a", "order", (1, 1), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, 1), 0),
                ],
            ],
        },
        "c": {
            "img": [
                [("a", "order", (1, -1), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, -1), 0),
                ],
            ],
        },
        "d": {
            "img": [
                [("a", "order", (1, 1), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, 1), 0),
                ],
            ],
        },
        "END_order": {
            "img": [
                [
                    ("a", "order", (1, -1), 0),
                    ("b", "order", (1, 1), 0),
                    ("c", "order", (1, -1), 0),
                    ("d", "order", (1, 1), 0),
                ],
            ]
        },
    }

    occn = OCCausalNet.from_dict(marker_groups)
    return occn


def occn_multi_ot():
    marker_groups = {
        "START_order": {
            "img": [],
            "omg": [
                [("a", "order", (1, 1), 0)],
            ],
        },
        "START_item": {
            "img": [],
            "omg": [
                [("a", "item", (1, -1), 0)],
            ],
        },
        "a": {
            "img": [
                [
                    ("START_order", "order", (1, 1), 0),
                    ("START_item", "item", (1, -1), 0),
                ],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, 1), 0),
                    ("END_item", "item", (1, -1), 0),
                ],
            ],
        },
        "END_order": {
            "img": [
                [("a", "order", (1, 1), 0)],
            ]
        },
        "END_item": {
            "img": [
                [("a", "item", (1, -1), 0)],
            ]
        },
    }

    occn = OCCausalNet.from_dict(marker_groups)
    return occn


def occn_multi_ot_multi_arc():
    marker_groups = {
        "START_order": {
            "omg": [
                [("a", "order", (1, 1), 0)],
            ],
        },
        "START_item": {
            "omg": [
                [("a", "item", (1, -1), 0)],
            ],
        },
        "a": {
            "img": [
                [
                    ("START_order", "order", (1, 1), 0),
                    ("START_item", "item", (1, -1), 0),
                ],
            ],
            "omg": [
                [
                    ("b", "order", (1, 1), 0),
                    ("b", "item", (1, -1), 0),
                ],
            ],
        },
        "b": {
            "img": [
                [
                    ("a", "order", (1, 1), 0),
                    ("a", "item", (1, -1), 0),
                ],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, 1), 0),
                    ("END_item", "item", (1, -1), 0),
                ],
            ],
        },
        "END_order": {
            "img": [
                [("b", "order", (1, 1), 0)],
            ]
        },
        "END_item": {
            "img": [
                [("b", "item", (1, -1), 0)],
            ]
        },
    }

    occn = OCCausalNet.from_dict(marker_groups)
    return occn


def occn_multi_ot_multi_marker():
    marker_groups = {
        "START_order": {
            "img": [],
            "omg": [
                [("a", "order", (1, 1), 0)],
            ],
        },
        "START_item": {
            "img": [],
            "omg": [
                [("a", "item", (1, -1), 0)],
            ],
        },
        "a": {
            "img": [
                [
                    ("START_order", "order", (1, 1), 0),
                    ("START_item", "item", (1, -1), 0),
                ],
                [
                    ("START_item", "item", (1, -1), 0),
                ],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, 1), 0),
                    ("END_item", "item", (1, -1), 0),
                ],
                [
                    ("END_item", "item", (1, -1), 0),
                ],
            ],
        },
        "END_order": {
            "img": [
                [("a", "order", (1, 1), 0)],
            ]
        },
        "END_item": {
            "img": [
                [("a", "item", (1, -1), 0)],
            ]
        },
    }

    occn = OCCausalNet.from_dict(marker_groups)
    return occn


def occn_ABC():
    marker_groups = {
        "START_order": {
            "img": [],
            "omg": [
                [("a", "order", (1, 1), 0)],
            ],
        },
        "a": {
            "img": [
                [("START_order", "order", (1, 1), 0)],
            ],
            "omg": [
                [("b", "order", (1, 1), 0)],
            ],
        },
        "b": {
            "img": [
                [("a", "order", (1, 1), 0)],
            ],
            "omg": [
                [("c", "order", (1, 1), 0)],
            ],
        },
        "c": {
            "img": [
                [("b", "order", (1, 1), 0)],
            ],
            "omg": [
                [("END_order", "order", (1, 1), 0)],
            ],
        },
        "END_order": {
            "img": [
                [("c", "order", (1, 1), 0)],
            ]
        },
    }

    occn = OCCausalNet.from_dict(marker_groups)
    return occn


def occn_ABC():
    marker_groups = {
        "START_order": {
            "img": [],
            "omg": [
                [("a", "order", (1, 1), 0)],
            ],
        },
        "a": {
            "img": [
                [("START_order", "order", (1, 1), 0)],
            ],
            "omg": [
                [("b", "order", (1, 1), 0)],
            ],
        },
        "b": {
            "img": [
                [("a", "order", (1, 1), 0)],
            ],
            "omg": [
                [("c", "order", (1, 1), 0)],
            ],
        },
        "c": {
            "img": [
                [("b", "order", (1, 1), 0)],
            ],
            "omg": [
                [("END_order", "order", (1, 1), 0)],
            ],
        },
        "END_order": {
            "img": [
                [("c", "order", (1, 1), 0)],
            ]
        },
    }

    occn = OCCausalNet.from_dict(marker_groups)
    return occn


def occn_multi_ot_multi_arc():
    marker_groups = {
        "START_order": {
            "omg": [
                [("a", "order", (1, 1), 0)],
            ],
        },
        "START_item": {
            "omg": [
                [("a", "item", (1, -1), 0)],
            ],
        },
        "a": {
            "img": [
                [
                    ("START_order", "order", (1, 1), 0),
                    ("START_item", "item", (1, -1), 0),
                ],
            ],
            "omg": [
                [
                    ("b", "order", (1, 1), 0),
                    ("b", "item", (1, -1), 0),
                ],
            ],
        },
        "b": {
            "img": [
                [
                    ("a", "order", (1, 1), 0),
                    ("a", "item", (1, -1), 0),
                ],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, 1), 0),
                    ("END_item", "item", (1, -1), 0),
                ],
            ],
        },
        "END_order": {
            "img": [
                [("b", "order", (1, 1), 0)],
            ]
        },
        "END_item": {
            "img": [
                [("b", "item", (1, -1), 0)],
            ]
        },
    }

    occn = OCCausalNet.from_dict(marker_groups)
    return occn


def occn_multi_ot_multi_min_0():
    marker_groups = {
        "START_order": {
            "omg": [
                [("a", "order", (1, 1), 0)],
            ],
        },
        "START_item": {
            "omg": [
                [("a", "item", (1, -1), 0)],
            ],
        },
        "a": {
            "img": [
                [
                    ("START_order", "order", (1, 1), 0),
                    ("START_item", "item", (0, -1), 0),
                ],
            ],
            "omg": [
                [
                    ("b", "order", (1, 1), 0),
                    ("b", "item", (0, -1), 0),
                ],
            ],
        },
        "b": {
            "img": [
                [
                    ("a", "order", (1, 1), 0),
                    ("a", "item", (0, -1), 0),
                ],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, 1), 0),
                    ("END_item", "item", (0, -1), 0),
                ],
            ],
        },
        "END_order": {
            "img": [
                [("b", "order", (1, 1), 0)],
            ]
        },
        "END_item": {
            "img": [
                [("b", "item", (1, -1), 0)],
            ]
        },
    }

    occn = OCCausalNet.from_dict(marker_groups)
    return occn


def occn_multi_ot_multi_marker():
    marker_groups = {
        "START_order": {
            "img": [],
            "omg": [
                [("a", "order", (1, 1), 0)],
            ],
        },
        "START_item": {
            "img": [],
            "omg": [
                [("a", "item", (1, -1), 0)],
            ],
        },
        "a": {
            "img": [
                [
                    ("START_order", "order", (1, 1), 0),
                    ("START_item", "item", (1, -1), 0),
                ],
                [
                    ("START_item", "item", (1, -1), 0),
                ],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, 1), 0),
                    ("END_item", "item", (1, -1), 0),
                ],
                [
                    ("END_item", "item", (1, -1), 0),
                ],
            ],
        },
        "END_order": {
            "img": [
                [("a", "order", (1, 1), 0)],
            ]
        },
        "END_item": {
            "img": [
                [("a", "item", (1, -1), 0)],
            ]
        },
    }

    occn = OCCausalNet.from_dict(marker_groups)
    return occn


def occn_multi_ot_multi_marker_redundant_mg():
    marker_groups = {
        "START_order": {
            "img": [],
            "omg": [
                [("a", "order", (1, 1), 0)],
            ],
        },
        "START_item": {
            "img": [],
            "omg": [
                [("a", "item", (1, -1), 0)],
            ],
        },
        "a": {
            "img": [
                [
                    ("START_order", "order", (1, 1), 0),
                    ("START_item", "item", (1, -1), 0),
                ],
                [
                    ("START_order", "order", (1, 1), 0),
                    ("START_item", "item", (1, 1), 0),
                ],
                [
                    ("START_order", "order", (1, 1), 0),
                    ("START_item", "item", (2, 2), 0),
                ],
                [
                    ("START_item", "item", (0, -1), 0),
                ],
                [
                    ("START_item", "item", (1, 1), 0),
                ],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, 1), 0),
                    ("END_item", "item", (1, -1), 0),
                ],
                [
                    ("END_order", "order", (1, 1), 0),
                    ("END_item", "item", (1, 1), 0),
                ],
                [
                    ("END_item", "item", (0, -1), 0),
                ],
                [
                    ("END_item", "item", (1, -1), 0),
                ],
                [
                    ("END_item", "item", (1, -1), 0),
                ],
            ],
        },
        "END_order": {
            "img": [
                [("a", "order", (1, 1), 0)],
            ]
        },
        "END_item": {
            "img": [
                [("a", "item", (1, -1), 0)],
            ]
        },
    }

    occn = OCCausalNet.from_dict(marker_groups)
    return occn


def occn_start_parallel():
    marker_groups = {
        "START_order": {
            "img": [],
            "omg": [
                [("a", "order", (1, 1), 0), ("b", "order", (1, 1), 0)],
                [("a", "order", (1, -1), 0)],
                [("b", "order", (1, -1), 0)],
            ],
        },
        "a": {
            "img": [
                [
                    ("START_order", "order", (1, 1), 0),
                ],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, 1), 0),
                ],
            ],
        },
        "b": {
            "img": [
                [
                    ("START_order", "order", (1, 1), 0),
                ],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, 1), 0),
                ],
            ],
        },
        "END_order": {
            "img": [
                [("a", "order", (1, 1), 0), ("b", "order", (1, 1), 0)],
                [("a", "order", (1, -1), 0)],
                [("b", "order", (1, -1), 0)],
            ]
        },
    }

    occn = OCCausalNet.from_dict(marker_groups)
    return occn


TEST_OCCN_FACTORIES = [
    occn_basic,
    occn_basic_2,
    occn_basic_3,
    occn_multi,
    occn_combined,
    occn_multi_marker,
    occn_multi_square_marker,
    occn_triple_marker,
    occn_key,
    occn_key_input,
    occn_key_order,
    occn_multi_key,
    occn_multi_key_2,
    occn_multi_ot,
    occn_multi_ot_multi_arc,
    occn_multi_ot_multi_marker,
]


### INVALID OCCNs ###
def occn_invalid_inconsistent_mg():
    """
    Invalid OCCN with inconsistent marker groups:
    Activity c has b as input but b does not have c as output.
    """
    marker_groups = {
        "START_order": {
            "img": [],
            "omg": [
                [("a", "order", (1, 1), 0)],
            ],
        },
        "a": {
            "img": [
                [("START_order", "order", (1, 1), 0)],
            ],
            "omg": [
                [("b", "order", (1, 1), 0)],
            ],
        },
        "b": {
            "img": [
                [("a", "order", (1, 1), 0)],
            ],
            "omg": [
                [("END_order", "order", (1, 1), 0)],
            ],
        },
        "c": {
            "img": [
                [("b", "order", (1, 1), 0)],
            ],
            "omg": [
                [("END_order", "order", (1, 1), 0)],
            ],
        },
        "END_order": {
            "img": [
                [("c", "order", (1, 1), 0)],
                [("b", "order", (1, 1), 0)],
            ],
        },
    }

    occn = OCCausalNet.from_dict(marker_groups)
    return occn


def occn_invalid_inconsistent_mg_2():
    """
    Invalid OCCN with inconsistent marker groups:
    Activity c has a as input but a does not have c as output.
    """
    marker_groups = {
        "START_order": {
            "img": [],
            "omg": [
                [("a", "order", (1, 1), 0)],
            ],
        },
        "a": {
            "img": [
                [("START_order", "order", (1, 1), 0)],
            ],
            "omg": [
                [("b", "order", (1, 1), 0)],
            ],
        },
        "b": {
            "img": [
                [("a", "order", (1, 1), 0)],
            ],
            "omg": [
                [("c", "order", (1, 1), 0)],
            ],
        },
        "c": {
            "img": [
                [("b", "order", (1, 1), 0)],
                [("a", "order", (1, 1), 0)],
            ],
            "omg": [
                [("END_order", "order", (1, 1), 0)],
            ],
        },
        "END_order": {
            "img": [
                [("c", "order", (1, 1), 0)],
            ],
        },
    }

    occn = OCCausalNet.from_dict(marker_groups)
    return occn


def occn_invalid_inconsistent_mg_3():
    """
    Invalid OCCN with inconsistent marker groups:
    Activity c has a as input but a does not have c as output.
    """
    marker_groups = {
        "START_order": {
            "img": [],
            "omg": [
                [("a", "order", (1, 1), 0)],
            ],
        },
        "a": {
            "img": [
                [("START_order", "order", (1, 1), 0)],
            ],
            "omg": [
                [("b", "order", (1, 1), 0)],
            ],
        },
        "b": {
            "img": [
                [("a", "order", (1, 1), 0)],
            ],
            "omg": [
                [("c", "order", (1, 1), 0)],
            ],
        },
        "c": {
            "img": [
                [("b", "order", (1, 1), 0), ("a", "order", (1, 1), 0)],
            ],
            "omg": [
                [("END_order", "order", (1, 1), 0)],
            ],
        },
        "END_order": {
            "img": [
                [("c", "order", (1, 1), 0)],
            ],
        },
    }

    occn = OCCausalNet.from_dict(marker_groups)
    return occn


TEST_INVALID_OCCN_FACTORIES = [
    occn_invalid_inconsistent_mg,
    occn_invalid_inconsistent_mg_2,
    occn_invalid_inconsistent_mg_3,
]
