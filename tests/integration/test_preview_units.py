from Paramood.bridge.formatting import display_quantity
from Paramood.core.expressions import Quantity, LENGTH, ANGLE


def test_preview_converts_mm_to_inches():
    assert display_quantity(Quantity(25.4, LENGTH), 'in') == 1.0


def test_preview_converts_radians_to_degrees():
    from math import pi

    assert display_quantity(Quantity(pi / 4, ANGLE), 'deg') == 45.0


def test_unitless_value_is_unchanged():
    from Paramood.core.expressions import SCALAR

    assert display_quantity(Quantity(5, SCALAR), '') == 5


def test_unit_mismatch_is_rejected():
    import pytest

    with pytest.raises(ValueError):
        display_quantity(Quantity(5, LENGTH), 'deg')
