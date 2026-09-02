"""
Request parsing and response shaping shared by the variant endpoints.

Both ``GET /api/variants/`` (discovery) and
``POST /api/files/<pk>/process_executions/`` (materialisation) describe *how
process executions are extracted* with the same parameters, so the parsing
and the validation against the (possibly filtered) log live here once.

List parameters are accepted as repeated query parameters
(``?business_activities=a&business_activities=b``) or as JSON lists in a
request body -- never comma-separated, because activity names may contain
commas.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from hashlib import sha1
from typing import Optional, Sequence

from totem_lib.variants import EXTRACTIONS
from totem_lib.variants.ocvariants import calculate_layout

VALID_EXTRACTIONS = frozenset(EXTRACTIONS)
VALID_ISOS = frozenset({"db_signature", "trace", "signature", "wl", "wl+vf2", "exact"})
LEADING_EXTRACTIONS = frozenset({"leading_1hop", "leading_bfs"})
RESOURCE_AWARE_EXTRACTION = "resource_aware"

DEFAULT_EXTRACTION = "leading_1hop"
DEFAULT_ISO = "wl+vf2"
DEFAULT_TIMEOUT_S = 10.0


class VariantParamError(ValueError):
    """A request parameter is invalid; the message is safe to show the user."""


def string_list(source, key: str) -> list[str]:
    """Read a list-valued parameter from a QueryDict or a parsed JSON body."""
    if hasattr(source, "getlist"):
        values = source.getlist(key)
    else:
        values = source.get(key, [])
        if values is None:
            values = []
        if isinstance(values, str):
            values = [values]
        if not isinstance(values, (list, tuple)):
            raise VariantParamError(f"'{key}' must be a list of strings.")
    cleaned = []
    for value in values:
        if not isinstance(value, str):
            raise VariantParamError(f"'{key}' must be a list of strings.")
        value = value.strip()
        if value and value not in cleaned:
            cleaned.append(value)
    return cleaned


@dataclass(frozen=True)
class ExtractionParams:
    """How process executions are cut out of the log."""

    extraction: str = DEFAULT_EXTRACTION
    leading_type: Optional[str] = None
    business_object_types: tuple[str, ...] = ()
    #: ``None`` means "every activity" for the resource-aware extraction.
    business_activities: Optional[tuple[str, ...]] = None

    def cache_params(self) -> dict:
        return {
            "extraction": self.extraction,
            "leading_type": self.leading_type or "",
            "business_object_types": list(self.business_object_types),
            "business_activities": (
                None if self.business_activities is None else list(self.business_activities)
            ),
        }

    def library_kwargs(self) -> dict:
        """Keyword arguments for ``find_variants`` / ``extract_process_executions``."""
        return {
            "extraction": self.extraction,
            "leading_type": self.leading_type,
            "business_object_types": list(self.business_object_types) or None,
            "business_activities": (
                None if self.business_activities is None else list(self.business_activities)
            ),
        }


def parse_extraction_params(source) -> ExtractionParams:
    """Parse the extraction parameters from a QueryDict or JSON body."""
    extraction = source.get("extraction") or DEFAULT_EXTRACTION
    if extraction not in VALID_EXTRACTIONS:
        raise VariantParamError(
            f"Invalid extraction '{extraction}'. Allowed: {sorted(VALID_EXTRACTIONS)}"
        )
    leading_type = source.get("leading_type") or None
    if leading_type is not None and not isinstance(leading_type, str):
        raise VariantParamError("'leading_type' must be a string.")

    business_object_types = tuple(string_list(source, "business_object_types"))
    business_activities: Optional[tuple[str, ...]] = None
    if extraction == RESOURCE_AWARE_EXTRACTION:
        if not business_object_types:
            raise VariantParamError(
                "The resource-aware extraction needs at least one business object type."
            )
        activities = string_list(source, "business_activities")
        business_activities = tuple(activities) if activities else None
    return ExtractionParams(
        extraction=extraction,
        leading_type=leading_type if extraction in LEADING_EXTRACTIONS else None,
        business_object_types=business_object_types if extraction == RESOURCE_AWARE_EXTRACTION else (),
        business_activities=business_activities,
    )


def parse_iso(source) -> str:
    iso = source.get("iso") or DEFAULT_ISO
    if iso not in VALID_ISOS:
        raise VariantParamError(f"Invalid iso '{iso}'. Allowed: {sorted(VALID_ISOS)}")
    return iso


def parse_timeout(source) -> Optional[float]:
    """Seconds, or ``None`` to disable the watchdog (``timeout_s <= 0``)."""
    raw = source.get("timeout_s", DEFAULT_TIMEOUT_S)
    try:
        timeout_s = float(raw)
    except (TypeError, ValueError):
        return DEFAULT_TIMEOUT_S
    return None if timeout_s <= 0 else timeout_s


def resolve_extraction_params(
    params: ExtractionParams,
    object_types: Sequence[str],
    activities: Sequence[str],
) -> Optional[ExtractionParams]:
    """
    Reconcile the request with what the (filtered) log actually contains.

    * A leading type the log no longer has falls back to the first type, so a
      filter that removed the selected type yields a sensible result instead
      of an empty one.
    * Business object types / activities are narrowed to the ones present;
      losing all of them is an error the user should see.

    Returns ``None`` when the log has no object types at all -- there is
    nothing to compute.
    """
    if not object_types:
        return None
    if params.extraction in LEADING_EXTRACTIONS:
        leading = params.leading_type
        if not leading or leading not in object_types:
            leading = sorted(object_types)[0]
        return replace(params, leading_type=leading)
    if params.extraction == RESOURCE_AWARE_EXTRACTION:
        kept_types = tuple(t for t in params.business_object_types if t in object_types)
        if not kept_types:
            raise VariantParamError(
                "None of the selected business object types exist in the "
                "(filtered) event log."
            )
        kept_activities = params.business_activities
        if kept_activities is not None:
            kept_activities = tuple(a for a in kept_activities if a in activities)
            if not kept_activities:
                raise VariantParamError(
                    "None of the selected business activities exist in the "
                    "(filtered) event log."
                )
        return replace(
            params, business_object_types=kept_types, business_activities=kept_activities
        )
    return replace(params, leading_type=None)


def serialize_variants(mined, layout_ocel) -> list[dict]:
    """Variants -> the JSON the Variants Explorer renders (nodes/edges/objects)."""
    out = []
    for var in mined:
        layout_data = calculate_layout(var, layout_ocel)

        signature = " → ".join(
            node_data["label"]
            for _, node_data in sorted(
                var.graph.nodes(data=True), key=lambda x: x[1]["timestamp"]
            )
        )
        signature_hash = sha1(signature.encode("utf-8")).hexdigest()[:8]

        final_nodes = [
            {
                "id": node["id"],
                "activity": node["activity"],
                "x": node["x"],
                "y_lane": node["y_lane"],
                "y_lanes": node["y_lanes"],
                "objectIds": [f"type::{t}" for t in node["types"]],
                "types": node["types"],
            }
            for node in layout_data["nodes"]
        ]

        out.append(
            {
                "id": str(var.id),
                "support": int(var.support),
                "signature": signature_hash,
                "signature_hash": signature_hash,
                "case_ids": list(var.case_ids or []),
                "graph": {
                    "nodes": final_nodes,
                    "edges": layout_data["edges"],
                    "objects": layout_data["objects"],
                },
            }
        )
    return out
