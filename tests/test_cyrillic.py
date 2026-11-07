from Paramood.core.expressions import LENGTH, Quantity, plan_batch


def test_cyrillic_hierarchy_in_batch():
    result = plan_batch(
        'корпус.высота=корпус.ширина+2 mm', {'корпус_ширина': Quantity(3, LENGTH)}, 'mm'
    )
    assert result[0].name == 'корпус_высота'
    assert result[0].quantity.value == 5
