"""
Backend entry point of the wide playout: run a playout directly on an
editor model JSON dict (OCPN or OCCN) and return the JSON-shaped result.

For OCCN models the START_<type>/END_<type> pseudo activities are limited
automatically to the number of objects of their type (each object starts
once and is expected to end once), overriding any user-provided values —
exactly like the frontend's buildActivityLimits did. The effective budget
map is returned under `effectiveActivityLimits`.
"""

from typing import Dict

from .occn_engine import create_occn_engine
from .ocpn_engine import create_ocpn_engine
from .search import run_playout
from .types import PlayoutConfig


def _name_of(entry) -> str:
    """Object type / activity entries may be {"name": ...} dicts or strings."""
    if isinstance(entry, dict):
        return entry["name"]
    return entry


def playout_from_model_dict(
    model_format: str,
    model: dict,
    objects_per_type: Dict[str, int],
    activity_limits: Dict[str, int],
    timeout_s: float,
    max_stored_variants: int = 2000,
    max_states: int = 5_000_000,
) -> dict:
    """
    Runs a variants-mode playout on an editor model dict.

    Returns `PlayoutResult.to_json_dict()` plus the key
    `effectiveActivityLimits` (the budget map actually used).
    Raises ValueError on invalid input.
    """
    if model_format not in ("ocpn", "occn"):
        raise ValueError(f'Unknown model format "{model_format}" — expected "ocpn" or "occn".')
    if not isinstance(model, dict):
        raise ValueError("The model must be a JSON object.")

    effective_limits = dict(activity_limits)

    if model_format == "ocpn":
        for key in ("objectTypes", "places", "transitions", "arcs"):
            if not isinstance(model.get(key), list):
                raise ValueError(f'The OCPN model is missing the "{key}" list.')
        engine = create_ocpn_engine(model, objects_per_type)
    else:
        if not isinstance(model.get("objectTypes"), list):
            raise ValueError('The OCCN model is missing the "objectTypes" list.')
        if not isinstance(model.get("markerGroups"), dict):
            raise ValueError('The OCCN model is missing the "markerGroups" object.')
        object_types = [_name_of(entry) for entry in model["objectTypes"]]
        activities = [_name_of(entry) for entry in model.get("activities") or []]
        # START_/END_ pseudo activities are auto-limited to the object count
        # of their type (overriding user-provided values).
        for ot in object_types:
            count = objects_per_type.get(ot, 0)
            effective_limits[f"START_{ot}"] = count
            effective_limits[f"END_{ot}"] = count
        engine = create_occn_engine(
            object_types, model["markerGroups"], objects_per_type, activities
        )

    result = run_playout(
        engine,
        PlayoutConfig(
            mode="variants",
            objects_per_type=objects_per_type,
            activity_limits=effective_limits,
            default_activity_limit=1,
            timeout_s=timeout_s,
            max_stored_variants=max_stored_variants,
            max_states=max_states,
        ),
    )
    return {**result.to_json_dict(), "effectiveActivityLimits": effective_limits}
