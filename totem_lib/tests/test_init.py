import pytest
import totem_lib

def test_all_variable_is_accurate():
    """
    Ensures that all symboles defined in totem_lib.__all__ actually exist.
    As a side effect, this also ensures that that all imports work correctly.
    """
    # Get all public attributes actually in the module
    actual_symbols = {
        name for name in dir(totem_lib)
        if not name.startswith("_")
    }

    # Get the expected symbols defined in __all__
    defined_symbols = set(totem_lib.__all__)

    # Check for items in __all__ that don't actually exist
    missing_in_implementation = defined_symbols - actual_symbols
    assert not missing_in_implementation, (
        f"The following symbols are in __all__ but not imported in __init__.py: "
        f"{missing_in_implementation}"
    )