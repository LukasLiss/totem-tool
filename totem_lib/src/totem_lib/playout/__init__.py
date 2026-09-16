"""
Wide playout of object-centric models (OCPN + OCCN).

Enumerates the complete process executions a model allows for a fixed
number of objects per type and per-activity occurrence budgets, and
reduces them to object-centric variants (executions equal up to object
renaming and reordering of independent events). Python port of the
frontend playout engine.
"""

from .canon import PERMUTATION_CAP, CanonicalExecution, canonicalize_execution, event_letter
from .occn_engine import (
    create_occn_engine,
    is_end_activity,
    is_start_activity,
    occn_object_type_of,
)
from .ocel_export import variants_to_ocel_dict
from .ocpn_engine import create_ocpn_engine, is_ocpn_silent, ocpn_budget_key
from .search import run_playout
from .service import playout_from_model_dict
from .types import (
    PlayoutConfig,
    PlayoutEngine,
    PlayoutEvent,
    PlayoutProgress,
    PlayoutResult,
    PlayoutStep,
    PlayoutVariant,
    TooManyBindingsError,
)

__all__ = [
    "CanonicalExecution",
    "canonicalize_execution",
    "create_occn_engine",
    "create_ocpn_engine",
    "event_letter",
    "is_end_activity",
    "is_ocpn_silent",
    "is_start_activity",
    "occn_object_type_of",
    "ocpn_budget_key",
    "PERMUTATION_CAP",
    "playout_from_model_dict",
    "PlayoutConfig",
    "PlayoutEngine",
    "PlayoutEvent",
    "PlayoutProgress",
    "PlayoutResult",
    "PlayoutStep",
    "PlayoutVariant",
    "run_playout",
    "TooManyBindingsError",
    "variants_to_ocel_dict",
]
