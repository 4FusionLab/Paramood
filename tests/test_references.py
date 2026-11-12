from Paramood.core.references import expression_references, reference_paths


def test_paths_preserve_indirection_despite_transitive_native_edges():
    expressions = {'width': '10 mm', 'half': 'width/2', 'd1': 'half', 'd2': 'width+width_extra'}
    dependencies = {'width': set(), 'half': {'width'}, 'd1': {'width', 'half'}, 'd2': {'width'}}
    assert reference_paths('width', expressions, dependencies) == {
        'width': ['width'],
        'half': ['width', 'half'],
        'd1': ['width', 'half', 'd1'],
        'd2': ['width', 'd2'],
    }


def test_quotes_boundaries_and_cyrillic():
    assert expression_references(
        "'width' + корпус_ширина + width_extra + 2\"", {'width', 'корпус_ширина'}
    ) == {'корпус_ширина'}
