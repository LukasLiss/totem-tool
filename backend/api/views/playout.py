"""Playout of editor models (OCPN / OCCN) and OCEL export of the result."""

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from totem_lib.playout import (
    PlayoutEvent,
    PlayoutVariant,
    TooManyBindingsError,
    playout_from_model_dict,
    variants_to_ocel_dict,
)


def _clamped_number(value, field: str, lo, hi, integer: bool = False):
    """Coerce a JSON number, clamped to [lo, hi]. Raises ValueError."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f'"{field}" must be a number.')
    if value != value:  # NaN
        raise ValueError(f'"{field}" must be a finite number.')
    # Clamp before int(): overflowing JSON numbers parse to inf, and
    # int(inf) would raise OverflowError (an unhandled 500) instead.
    number = max(lo, min(hi, value))
    return int(number) if integer else float(number)


def _clamped_count_map(value, field: str, hi: int) -> dict:
    """Coerce a {name: int} JSON object with values clamped to [0, hi]."""
    if not isinstance(value, dict):
        raise ValueError(f'"{field}" must be an object mapping names to numbers.')
    counts = {}
    for key, raw in value.items():
        if isinstance(raw, bool) or not isinstance(raw, (int, float)):
            raise ValueError(f'"{field}" value for "{key}" must be a number.')
        if raw != raw:  # NaN
            raise ValueError(f'"{field}" value for "{key}" must be a finite number.')
        counts[key] = int(max(0, min(hi, raw)))
    return counts


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def playout(request):
    """
    Runs a wide playout of an editor model (OCPN or OCCN) and returns the
    object-centric variants. The model comes in the request body — no stored
    file involved. A search that merely hits the timeout / state cap is a
    normal 200 (flags in the payload); only invalid input is a 400.
    """
    data = request.data
    if not isinstance(data, dict):
        return Response(
            {"error": "Request body must be a JSON object."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        model_format = data.get("modelFormat")
        if not isinstance(model_format, str):
            raise ValueError('"modelFormat" must be "ocpn" or "occn".')
        model = data.get("model")
        if not isinstance(model, dict):
            raise ValueError('"model" must be the editor model JSON object.')
        objects_per_type = _clamped_count_map(
            data.get("objectsPerType"), "objectsPerType", 12
        )
        activity_limits = _clamped_count_map(
            data.get("activityLimits"), "activityLimits", 20
        )
        timeout_s = _clamped_number(data.get("timeoutS"), "timeoutS", 1.0, 120.0)
        max_stored_variants = _clamped_number(
            data.get("maxStoredVariants", 2000),
            "maxStoredVariants",
            1,
            2000,
            integer=True,
        )
        max_states = _clamped_number(
            data.get("maxStates", 5_000_000), "maxStates", 1, 5_000_000, integer=True
        )

        result = playout_from_model_dict(
            model_format,
            model,
            objects_per_type,
            activity_limits,
            timeout_s=timeout_s,
            max_stored_variants=max_stored_variants,
            max_states=max_states,
        )
    except (ValueError, TooManyBindingsError) as e:
        return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
    except (TypeError, KeyError, AttributeError) as e:
        # Model dicts are only minimally validated (the editors already did) —
        # a malformed model surfaces here instead of as a 500.
        return Response(
            {"error": f"Malformed model: {e!r}"}, status=status.HTTP_400_BAD_REQUEST
        )

    return Response(result, status=status.HTTP_200_OK)


# The playout endpoint caps objects at 12 per type; these export bounds are
# far above anything a real playout result can contain, but keep a crafted
# ~60-byte body from making the export materialize billions of objects.
_EXPORT_MAX_COUNT_PER_TYPE = 10_000
_EXPORT_MAX_TOTAL_OBJECTS = 500_000


def _parse_playout_variants(raw) -> list:
    """Parses the JSON `variants` payload into PlayoutVariant objects."""
    if not isinstance(raw, list):
        raise ValueError('"variants" must be a list of playout variants.')
    variants = []
    total_objects = 0
    for v, entry in enumerate(raw):
        if not isinstance(entry, dict):
            raise ValueError(f"Variant #{v + 1} must be an object.")
        events_raw = entry.get("events")
        if not isinstance(events_raw, list):
            raise ValueError(f'Variant #{v + 1} is missing the "events" list.')
        events = []
        for i, event_raw in enumerate(events_raw):
            where = f"Variant #{v + 1}, event #{i + 1}"
            if not isinstance(event_raw, dict):
                raise ValueError(f"{where} must be an object.")
            activity = event_raw.get("activity")
            if not isinstance(activity, str) or not activity:
                raise ValueError(f'{where} needs a non-empty string "activity".')
            objects_raw = event_raw.get("objects")
            if not isinstance(objects_raw, dict):
                raise ValueError(
                    f'{where}: "objects" must map object types to id lists.'
                )
            objects = {}
            for ot, ids in objects_raw.items():
                if not isinstance(ids, list) or not all(
                    isinstance(o, str) for o in ids
                ):
                    raise ValueError(
                        f'{where}: "objects" of type "{ot}" must be a list of ids.'
                    )
                objects[ot] = list(ids)
            events.append(
                PlayoutEvent(
                    activity=activity,
                    # Optional on input; the OCEL export writes every event anyway.
                    visible=bool(event_raw.get("visible", True)),
                    objects=objects,
                )
            )
        counts_raw = entry.get("objectCounts", {})
        if not isinstance(counts_raw, dict):
            raise ValueError(f'Variant #{v + 1}: "objectCounts" must be an object.')
        object_counts = {}
        for ot, count_raw in counts_raw.items():
            if (
                isinstance(count_raw, bool)
                or not isinstance(count_raw, (int, float))
                or count_raw != count_raw  # NaN
                or count_raw < 0
                or count_raw > _EXPORT_MAX_COUNT_PER_TYPE
            ):
                raise ValueError(
                    f'Variant #{v + 1}: objectCounts for "{ot}" must be a number '
                    f"between 0 and {_EXPORT_MAX_COUNT_PER_TYPE}."
                )
            object_counts[ot] = int(count_raw)
        total_objects += sum(object_counts.values())
        if total_objects > _EXPORT_MAX_TOTAL_OBJECTS:
            raise ValueError(
                f"The export would create more than {_EXPORT_MAX_TOTAL_OBJECTS} objects "
                "— reduce the number of variants or objects."
            )
        variants.append(PlayoutVariant(events=events, object_counts=object_counts))
    return variants


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def playout_export_ocel(request):
    """Serializes playout variants (result of /api/playout/) to OCEL 2.0 JSON."""
    data = request.data
    if not isinstance(data, dict):
        return Response(
            {"error": "Request body must be a JSON object."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        variants = _parse_playout_variants(data.get("variants"))
        ocel = variants_to_ocel_dict(variants)
    except ValueError as e:
        return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
    except KeyError as e:
        # variants_to_ocel_dict resolves event objects against objectCounts —
        # an id outside "<type>_1".."<type>_<count>" has no export mapping.
        detail = str(e).replace("\x01", ":")
        return Response(
            {
                "error": f"Variant events reference an object not covered by objectCounts: {detail}"
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    return Response(ocel, status=status.HTTP_200_OK)
