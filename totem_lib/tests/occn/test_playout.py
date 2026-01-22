import pytest
from tests.assets.example_occns import occn_ABC
from totem_lib.occn import occn_playout


def test_playout_occn_empty_objects_raises():
    occn = occn_ABC()
    objects = {"order": set()}

    with pytest.raises(ValueError):
        valid_sequences_iter = occn_playout(occn, objects, max_bindings_per_activity=3)
        list(valid_sequences_iter)


@pytest.mark.parametrize(
    "orders,expected_count",
    [
        ({"o1"}, 1),
        ({"o1", "o2"}, 252),
    ],
)
def test_playout_occn_extensive(orders, expected_count):
    occn = occn_ABC()
    objects = {"order": orders}

    valid_sequences_iter = occn_playout(occn, objects, max_bindings_per_activity=3)
    valid_sequences = list(valid_sequences_iter)
    assert len(valid_sequences) == expected_count

def test_playout_occn_extensive_bf_limited():
        occn = occn_ABC()
        
        objects = {
            "order": {"o1", "o2"}
        }
        valid_sequences_iter = occn_playout(occn, objects, max_bindings_per_activity=3)
        valid_sequences = list(valid_sequences_iter)
        assert len(valid_sequences) == 252
        
        for _ in range (10):
            valid_sequences_iter_sub = occn_playout(occn, objects, max_bindings_per_activity=3, branching_factor_activities=1.5, branching_factor_bindings=1.5)
            valid_sequences_sub = list(valid_sequences_iter_sub)
            for seq in valid_sequences_sub:
                assert seq in valid_sequences