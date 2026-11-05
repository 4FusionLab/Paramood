from ..core.expressions import SCALAR, UNITS


def display_quantity(quantity, unit):
    if not unit and quantity.dimension == SCALAR:
        return quantity.value
    if unit not in UNITS or UNITS[unit][1] != quantity.dimension:
        raise ValueError('Unsupported output unit')
    return quantity.value / UNITS[unit][0]
