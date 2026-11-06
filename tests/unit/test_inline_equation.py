import pytest

from Paramood.core.expressions import ExpressionError, LENGTH, Quantity
from Paramood.core.inline_equation import solve_inline_equation


def test_solve_negative_scaled_new_parameter_for_length():
    assert solve_inline_equation('-width/5=50', 'd24', 'mm', {}) == 'width=-250.0 mm;d24=-width/5'


def test_equation_rejects_existing_variable_and_nonlinearity():
    with pytest.raises(ExpressionError):
        solve_inline_equation('-width/5=50', 'd24', 'mm', {'width': Quantity(10, LENGTH)})
    with pytest.raises(ExpressionError):
        solve_inline_equation('width*width=50', 'd24', 'mm', {})
