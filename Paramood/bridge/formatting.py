from ..core.expressions import TextValue, unit_definition


def display_quantity(quantity, unit):
    if isinstance(quantity, TextValue):
        return quantity.value
    factor, dimension, offset = unit_definition(unit)
    if dimension != quantity.dimension:
        raise ValueError('Incompatible output unit')
    return (quantity.value - offset) / factor
