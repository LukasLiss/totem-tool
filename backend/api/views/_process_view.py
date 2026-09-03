"""Parameter validation and JSON serialization for process-area / MLPA views."""

import math

from totem_lib.totem import Totem, totem_to_dict
from totem_lib.process_areas import INDICATOR_NAMES


# Defaults reproduce the thesis: uniform indicator weights, both objective
# terms weighted equally, and the thesis margin of exactly 1 (`margin_scale`
# is a reference-implementation extension and is not exposed over HTTP).
PROCESS_AREA_DEFAULTS = {"alpha": 1.0, "beta": 1.0, "weight": 1.0}


def _positive_float(params, name: str, default: float) -> float:
    """
    Read one non-negative, finite float query parameter.

    Raises `ValueError` so the caller can answer 400 — letting a bad value
    through surfaces later as a ZeroDivisionError or a NaN in the ILP, i.e. a
    500 for what is really a malformed request.
    """
    raw = params.get(name)
    if raw is None or raw == "":
        return default
    try:
        value = float(raw)
    except (TypeError, ValueError):
        raise ValueError(f"{name} must be a number, got {raw!r}")
    if not math.isfinite(value):
        raise ValueError(f"{name} must be finite, got {raw!r}")
    if value < 0:
        raise ValueError(f"{name} must be >= 0, got {value}")
    return value


def _parse_process_area_params(params) -> dict:
    """Validate the query parameters of the process-area discovery endpoint."""
    weights = {
        name: _positive_float(params, f"w_{name}", PROCESS_AREA_DEFAULTS["weight"])
        for name in INDICATOR_NAMES
    }
    if sum(weights.values()) <= 0:
        raise ValueError(
            "at least one of "
            + ", ".join(f"w_{name}" for name in INDICATOR_NAMES)
            + " must be greater than zero"
        )
    alpha = _positive_float(params, "alpha", PROCESS_AREA_DEFAULTS["alpha"])
    beta = _positive_float(params, "beta", PROCESS_AREA_DEFAULTS["beta"])
    if alpha == 0 and beta == 0:
        # Both zero makes the ILP objective identically zero, so every layer
        # assignment is equally optimal and the answer is whatever the solver
        # happened to pick.
        raise ValueError("at least one of alpha and beta must be greater than zero")
    return {"weights": weights, "alpha": alpha, "beta": beta}


def _process_area_cache_params(params: dict) -> dict:
    """
    Flatten the discovery parameters into the ``params`` dict that
    `cache_utils.make_cache_key` hashes.

    Every parameter has to be in here: `discover_mlpa` keys on the file alone,
    which is fine because it takes no parameters, but doing that here would
    make the UI sliders silently return the first result forever. Floats are
    rendered with `%.6g` rather than passed raw so that 1.0 and 1.0000001 —
    indistinguishable to the algorithm — do not produce two cache entries.
    """
    flat = {name: f"{params['weights'][name]:.6g}" for name in INDICATOR_NAMES}
    flat["alpha"] = f"{params['alpha']:.6g}"
    flat["beta"] = f"{params['beta']:.6g}"
    return flat


def _serialize_process_layers(process_view: dict) -> list:
    """
    Convert a process view — the shape both `mlpaDiscovery` and
    `discover_process_areas` return — into the frontend's layer list.

    {level: [(object_types, event_types), ...]}
      -> [{"level": int, "areas": [{"objectTypes": [...], "eventTypes": [...]}]}]
    """
    layers = []

    # Sort levels (MLPA produces floats like 0.0, 1.0, 2.0; the process-area
    # discovery produces ints)
    for level in sorted(process_view.keys()):
        areas = []
        for object_types_set, event_types_set in process_view[level]:
            # Convert sets to sorted lists for JSON serialization
            object_types = (
                sorted(list(object_types_set))
                if isinstance(object_types_set, set)
                else list(object_types_set)
            )
            event_types = (
                sorted(list(event_types_set))
                if isinstance(event_types_set, set)
                else list(event_types_set)
            )

            areas.append(
                {
                    "objectTypes": object_types,
                    "eventTypes": event_types,
                }
            )

        layers.append(
            {
                "level": int(level),  # Convert float to int for cleaner JSON
                "areas": areas,
            }
        )

    return layers


def _serialize_mlpa(process_view: dict, totem: Totem) -> dict:
    """
    Convert MLPA output into a JSON-serializable structure for the frontend.

    MLPA returns: {level: [(object_types_set, event_types_set), ...], ...}
    We convert to: {layers: [{level, areas: [{objectTypes, eventTypes}]}], ...}
    """
    # Also include the serialized totem data for edge information
    totem_data = totem_to_dict(totem)

    return {
        "layers": _serialize_process_layers(process_view),
        "tempgraph": totem_data["tempgraph"],
        "type_relations": totem_data["type_relations"],
        "all_event_types": totem_data["all_event_types"],
        "object_type_to_event_types": totem_data["object_type_to_event_types"],
    }
