"""Validation of stored view preferences (e.g. the OC-DFG layout options).

The backend stores these as opaque JSON objects: the frontend owns their
format, validates what it reads back and falls back to its defaults when an
entry is unusable. The backend only makes sure an entry is a JSON object (or
null) of bounded size, so one request cannot bloat a project or dashboard.
"""

import json

#: Upper bound of one stored preferences object, serialized.
MAX_PREFERENCES_BYTES = 16 * 1024


def preferences_error(value):
    """None when ``value`` may be stored, otherwise a message for a 400."""
    if value is None:
        return None
    if not isinstance(value, dict):
        return "must be a JSON object or null"
    try:
        size = len(json.dumps(value))
    except (TypeError, ValueError):
        return "must be JSON"
    if size > MAX_PREFERENCES_BYTES:
        return f"is too large ({size} bytes, at most {MAX_PREFERENCES_BYTES})"
    return None


def clean_preferences(value):
    """``value`` if it may be stored, else None (= the defaults)."""
    return value if preferences_error(value) is None else None
