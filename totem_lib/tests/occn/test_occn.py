from typing import Counter
import pytest
from totem_lib import OCCausalNet, OCCausalNetState
from tests.assets.example_occns import TEST_OCCN_FACTORIES, TEST_INVALID_OCCN_FACTORIES

@pytest.mark.parametrize("factory_func", TEST_OCCN_FACTORIES)
def test_constructor(factory_func):
    """
    Tests that OCCausalNet can be constructed using 
    the factory without errors.
    """
    # Assert no exceptions are raised
    occn = factory_func()
    assert isinstance(occn, OCCausalNet)
    
def test_occn_state():
    """
    Tests the OCCausalNet operators (+, -, <=, ==) and functions.
    """
    state = OCCausalNetState({'B': Counter([('A', 'o1', 'order')])})
    assert state.activities == {'B'}
    assert state.is_empty == False
    new_state = state + OCCausalNetState({'C': Counter([('B', 'o1', 'order')])})
    assert new_state.activities == {'B', 'C'}
    assert new_state.is_empty == False
    assert state <= new_state
    assert state != new_state
    new_state_copy = new_state.__deepcopy__()
    assert new_state == new_state_copy
    new_state -= OCCausalNetState({'C': Counter([('B', 'o1', 'order')])})
    assert state == new_state
    new_state -= OCCausalNetState({'B': Counter([('A', 'o1', 'order')])})
    assert new_state.is_empty == True
    
        
def test_invalid_marker():
    """
    Tests that constructing an invalid marker raises an error.
    """
    with pytest.raises((TypeError, ValueError)):
        OCCausalNet.Marker(
            related_activity="A",
            object_type="obj",
            count_range=(5, 3),  # Invalid range: min > max
            marker_key=1,
        )
    with pytest.raises((TypeError, ValueError)):
        OCCausalNet.Marker(
            related_activity="A",
            object_type="obj",
            count_range=(2, -1),  # Invalid range: min > max
            marker_key=0,
        )
    with pytest.raises((TypeError, ValueError)):
        OCCausalNet.Marker(
            related_activity="A",
            object_type="obj",
            count_range=(-1, -2),  # Invalid range: min > max
            marker_key=-1,
        )

def test_invalid_marker_group():
    """
    Tests that constructing an invalid marker group raises an error.
    """
    # Empty marker group is not allowed
    with pytest.raises((TypeError, ValueError)):
        OCCausalNet.MarkerGroup(markers=[])
    with pytest.raises((TypeError, ValueError)):
        OCCausalNet.MarkerGroup(markers=[], support_count=5)

@pytest.mark.parametrize("factory_func", TEST_INVALID_OCCN_FACTORIES)
def test_invalid_occn(factory_func):
    """
    Tests that constructing an invalid OCCN raises an error.
    """
    with pytest.raises((TypeError, ValueError, Exception)):
        factory_func()

def test_invalid_occn_relative_occurence_thresnhold():
    """
    Tests that constructing an OCCN with invalid relative occurrence threshold raises an error.
    """
    with pytest.raises(ValueError):
        OCCausalNet(
            dependency_graph={},
            input_marker_groups={},
            output_marker_groups={},
            relative_occurrence_threshold=-0.1,  # Invalid threshold
        )
    with pytest.raises(ValueError):
        OCCausalNet(
            dependency_graph={},
            input_marker_groups={},
            output_marker_groups={},
            relative_occurrence_threshold=1.5,  # Invalid threshold
        )