"""Validity rules for paired TOTeM event cardinalities."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))

from totem_lib.totem.totem import (
    EC_ONE,
    EC_ZERO,
    EC_ZERO_ONE,
    has_valid_event_cardinality_pair,
)


def test_rejects_contradictory_exact_event_cardinalities():
    assert not has_valid_event_cardinality_pair(EC_ONE, EC_ZERO, tau=1)
    assert not has_valid_event_cardinality_pair(EC_ZERO, EC_ONE, tau=1)


def test_allows_valid_or_non_exact_event_cardinality_pairs():
    assert has_valid_event_cardinality_pair(EC_ONE, EC_ZERO_ONE, tau=1)
    assert has_valid_event_cardinality_pair(EC_ONE, EC_ZERO, tau=0.99)
