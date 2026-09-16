"""
Shared types of the object-centric playout engines (OCPN + OCCN).

The "wide" playout enumerates complete process executions allowed by a
model, given a fixed number of objects per object type and a maximum
number of occurrences per activity. Executions that only differ by the
interleaving of independent events or by renaming objects of the same
type are the same *object-centric variant*; the engine counts and
returns variants, not raw firing sequences.

Faithful Python port of the TypeScript engine's `types.ts`;
`PlayoutResult.to_json_dict()` emits the camelCase JSON shape the
frontend consumes.
"""

from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Set


class TooManyBindingsError(Exception):
    """Raised when a single state enables too many bindings to enumerate."""

    def __init__(self) -> None:
        super().__init__(
            "Too many enabled bindings in a single state — reduce the number "
            "of objects or the activity limits."
        )


@dataclass
class PlayoutEvent:
    """One event of a process execution: an activity plus the bound objects."""

    activity: str
    # Silent transitions and START_/END_ pseudo activities are invisible.
    visible: bool
    # Object ids per object type, sorted.
    objects: Dict[str, List[str]]


@dataclass
class PlayoutVariant:
    """One object-centric variant (a canonical complete process execution)."""

    # Visible events in canonical order with canonical object names.
    events: List[PlayoutEvent]
    # Number of objects per type participating in visible events.
    object_counts: Dict[str, int]


@dataclass
class PlayoutProgress:
    states_explored: int
    completed_runs: int
    variant_count: int
    elapsed_s: float


@dataclass
class PlayoutConfig:
    """
    Playout parameters.

    `mode` is 'variants' (enumerate variants, dedup interleavings + object
    renaming) or 'raw' (count every complete binding/firing sequence without
    pruning or dedup, mirroring totem_lib's occn_playout).
    """

    mode: str
    # Objects per object type for one process execution.
    objects_per_type: Dict[str, int]
    # Max occurrences per budget key. Keys are activity labels; OCPN silent
    # transitions use their τ key (see budget_key of the engine). Budget keys
    # missing from the map fall back to `default_activity_limit`.
    activity_limits: Dict[str, int]
    # Wall-clock budget in seconds; when exceeded the result is a lower bound.
    timeout_s: float
    # Max variants kept in memory (counting continues beyond it).
    max_stored_variants: int
    # Hard safety cap on visited search nodes.
    max_states: int
    default_activity_limit: int = 1
    on_progress: Optional[Callable[[PlayoutProgress], None]] = None


@dataclass
class PlayoutResult:
    variants: List[PlayoutVariant] = field(default_factory=list)
    # Total distinct variants found (>= len(variants)).
    variant_count: int = 0
    # Complete executions reached (canonical ones in 'variants' mode).
    completed_runs: int = 0
    states_explored: int = 0
    elapsed_s: float = 0.0
    # True if the search space was fully explored within all limits.
    exhaustive: bool = True
    timed_out: bool = False
    # True if the state-cap was hit before the search finished.
    state_cap_hit: bool = False
    # True if variant dedup had to skip the full canonical minimization for
    # at least one execution (too many symmetric objects). The variant count
    # is then an upper bound of the true count (never an undercount).
    approximate_dedup: bool = False
    warnings: List[str] = field(default_factory=list)

    def to_json_dict(self) -> dict:
        """The camelCase JSON shape consumed by the frontend."""
        return {
            "variants": [
                {
                    "events": [
                        {
                            "activity": event.activity,
                            "visible": event.visible,
                            "objects": event.objects,
                        }
                        for event in variant.events
                    ],
                    "objectCounts": variant.object_counts,
                }
                for variant in self.variants
            ],
            "variantCount": self.variant_count,
            "completedRuns": self.completed_runs,
            "statesExplored": self.states_explored,
            "elapsedMs": int(self.elapsed_s * 1000),
            "exhaustive": self.exhaustive,
            "timedOut": self.timed_out,
            "stateCapHit": self.state_cap_hit,
            "approximateDedup": self.approximate_dedup,
            "warnings": self.warnings,
        }


@dataclass
class PlayoutStep:
    """
    One enabled step (a binding of an activity / a transition firing with a
    concrete object binding) offered by an engine in the current state.
    """

    # Stable serialization of the step's visible identity: activity plus
    # bound objects. Used as the letter for trace-normal-form pruning; equal
    # letters imply equal events.
    letter: str
    # All object ids bound by the step (for independence checks).
    object_ids: List[str]
    # Which activity budget the step consumes.
    budget_key: str
    event: PlayoutEvent
    # Applies the step to the engine state; returns the undo function.
    apply: Callable[[], Callable[[], None]]


@dataclass
class PlayoutEngine:
    """State-exploration interface implemented by the OCPN and OCCN engines."""

    # Object ids per type in canonical (creation) order.
    objects: Dict[str, List[str]]
    # Model-level warnings collected while preparing the engine.
    warnings: List[str]
    # Enabled steps in the current internal state. `used_objects` contains
    # ids of objects that already participated in an applied step; engines
    # apply the fresh-object symmetry reduction against it unless raw mode
    # is requested.
    enabled_steps: Callable[[Set[str], bool], List[PlayoutStep]]
    # True if the current state is a complete process execution.
    is_complete: Callable[[], bool]
    # Canonical serialization of the current state. Used to memoize the
    # completion count per (state, remaining budgets) in raw mode, exactly
    # like totem_lib's playout memoizes (state, activity_counts).
    state_key: Callable[[], str]
    # All budget keys the engine can consume (OCPN: budget keys of all
    # transitions; OCCN: all activities). Used to bound the search recursion.
    budget_keys: List[str]
