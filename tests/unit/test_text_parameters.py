import pytest

from Paramood.core.expressions import (
    LENGTH,
    ExpressionError,
    ParameterSnapshot,
    Quantity,
    TextValue,
    evaluate,
    normalize_expression,
    plan_batch,
    plan_batch_snapshot,
)
from Paramood.core.text import split_definitions, text_literal
from Paramood.core.variants import decode_variants, encode_variants, values_match


@pytest.mark.parametrize(
    ('expression', 'expected'),
    [
        ("'Корпус'", 'Корпус'),
        ('"Корпус"', 'Корпус'),
        ("''", ''),
        ('""', ''),
        ('"O\'Brien"', "O'Brien"),
        (r"'a\'b'", "a'b"),
        ("'a\"b'", 'a"b'),
        (r'"a\"b"', 'a"b'),
        (r"'C:\\Temp\\file'", r'C:\Temp\file'),
        (r"'a\nb\tc\r'", 'a\nb\tc\r'),
        ("'width=30;this;5n;box.width;__unit__'", 'width=30;this;5n;box.width;__unit__'),
    ],
)
def test_quoted_literals_roundtrip_without_changing_contents(expression, expected):
    op = plan_batch('caption=' + expression, {}, 'mm')[0]
    assert op.unit == 'Text' and isinstance(op.quantity, TextValue)
    assert op.quantity.value == expected
    assert evaluate(op.expression, {}).value == expected
    assert op.expression == text_literal(expected)


def test_string_separators_are_not_definitions_and_paths_are_not_rewritten():
    text = 'caption="a=b;c\\nbox.width";width=20'
    assert len(split_definitions(text)) == 2
    operations = plan_batch(text, {}, 'mm')
    assert len(operations) == 2
    assert operations[0].quantity.value == 'a=b;c\nbox.width'
    assert (
        normalize_expression("'box.width' + box.width", {'box_width'}) == "'box.width' + box_width"
    )


def test_text_references_and_conditionals_keep_the_source_expression():
    ops = plan_batch(
        "caption=prefix+'Body';prefix='Outer ';size=if(width<20 mm; 'Short'; 'Long')",
        {'width': Quantity(10, LENGTH)},
        'mm',
    )
    caption = next(op for op in ops if op.name == 'caption')
    assert caption.expression == "prefix+'Body'"
    assert caption.quantity.value == 'Outer Body'
    assert next(op for op in ops if op.name == 'size').quantity.value == 'Short'


@pytest.mark.parametrize(
    'text',
    [
        "x='unterminated",
        r"x='unsupported\q'",
        "x='a''b'",
        'x=word',
        "x='a'+2",
        "x='a'*2",
        'x=__import__("os")',
    ],
)
def test_invalid_or_ambiguous_strings_fail_closed(text):
    with pytest.raises(ValueError):
        plan_batch(text, {}, 'mm')


@pytest.mark.parametrize(
    ('text', 'existing'),
    [
        ('caption=20', {'caption': TextValue('Body')}),
        ("width='Body'", {'width': Quantity(10, LENGTH)}),
    ],
)
def test_existing_type_cannot_be_changed(text, existing):
    with pytest.raises(ExpressionError, match='dimension'):
        plan_batch(text, existing, 'mm')


def test_numeric_update_does_not_require_evaluating_unrelated_text_formulas():
    snapshot = {
        'width': ParameterSnapshot('10 mm', 'mm', Quantity(10, LENGTH), set()),
        'depth': ParameterSnapshot('5 mm', 'mm', Quantity(5, LENGTH), set()),
        'caption': ParameterSnapshot(
            'unsupported_text_function(depth)', 'Text', TextValue('Body'), {'depth'}
        ),
    }
    ops = plan_batch_snapshot('width=20', snapshot, 'mm')
    assert len(ops) == 1 and ops[0].quantity.value == 20
    with pytest.raises(ExpressionError):
        plan_batch_snapshot('copy=caption', snapshot, 'mm')
    with pytest.raises(ExpressionError):
        plan_batch_snapshot('depth=20', snapshot, 'mm')
    broken = {
        **snapshot,
        'caption': ParameterSnapshot("'Body'", 'Text', TextValue('Body'), {'unknown'}),
    }
    with pytest.raises(ExpressionError, match='Incomplete'):
        plan_batch_snapshot('width=20', broken, 'mm')


def test_text_snapshot_uses_api_graph_and_preserves_formulas():
    snapshot = {
        'base': ParameterSnapshot("'A'", 'Text', TextValue('A'), set()),
        'caption': ParameterSnapshot("base+'B'", 'Text', TextValue('AB'), {'base'}),
        'width': ParameterSnapshot('10 mm', 'mm', Quantity(10, LENGTH), set()),
    }
    ops = plan_batch_snapshot("caption=base+'C';width=30", snapshot, 'mm')
    assert next(op for op in ops if op.name == 'caption').quantity.value == 'AC'
    bad = {**snapshot, 'caption': ParameterSnapshot("base+'B'", 'Text', TextValue('AB'), set())}
    with pytest.raises(ExpressionError, match='Mismatched'):
        plan_batch_snapshot("caption='X'", bad, 'mm')


def test_text_variant_schema_roundtrips_empty_and_exact_values():
    variants = [
        {
            'id': 'one',
            'name': 'Text',
            'parameters': [
                {
                    'name': 'caption',
                    'entityToken': 'text-token',
                    'expression': "''",
                    'unit': 'Text',
                    'value': '',
                }
            ],
        }
    ]
    assert (
        decode_variants(
            encode_variants(
                variants,
                [
                    dict(
                        kind='parameter',
                        **{
                            key: variants[0]['parameters'][0][key]
                            for key in ('name', 'entityToken', 'unit')
                        },
                    )
                ],
            )
        )
        == variants
    )
    assert values_match('a  b', 'a  b')
    assert not values_match('a  b', 'a b')
    assert not values_match('1', 1)


def test_text_expansion_is_bounded_before_allocating_exponential_results():
    text = "p0='x';" + ';'.join(f'p{i}=p{i - 1}+p{i - 1}' for i in range(1, 31))
    with pytest.raises(ExpressionError, match='65536'):
        plan_batch(text, {}, 'mm')
    with pytest.raises(ExpressionError, match='Combined text'):
        plan_batch(
            ';'.join(f'p{i}=source' for i in range(20)), {'source': TextValue('x' * 32768)}, 'mm'
        )


def _empty_doubling_snapshot(source, count):
    snapshot = dict(source)
    previous = 'caption'
    for i in range(count):
        name = f'label{i}'
        snapshot[name] = ParameterSnapshot(
            f'{previous}+{previous}', 'Text', TextValue(''), {previous}
        )
        previous = name
    return snapshot


def test_existing_text_descendants_cannot_bypass_expansion_limit_on_update():
    snapshot = _empty_doubling_snapshot(
        {'caption': ParameterSnapshot("''", 'Text', TextValue(''), set())}, 20
    )
    with pytest.raises(ExpressionError, match='65536'):
        plan_batch_snapshot("caption='x'", snapshot, 'mm')


def test_numeric_update_checks_growth_through_existing_conditional_text():
    snapshot = _empty_doubling_snapshot(
        {
            'width': ParameterSnapshot('10 mm', 'mm', Quantity(10, LENGTH), set()),
            'caption': ParameterSnapshot(
                "if(width<20 mm; ''; 'x')", 'Text', TextValue(''), {'width'}
            ),
        },
        20,
    )
    with pytest.raises(ExpressionError, match='65536'):
        plan_batch_snapshot('width=30', snapshot, 'mm')


def test_safe_existing_descendants_include_their_other_text_ancestors():
    snapshot = {
        'width': ParameterSnapshot('10 mm', 'mm', Quantity(10, LENGTH), set()),
        'prefix': ParameterSnapshot("'A'", 'Text', TextValue('A'), set()),
        'caption': ParameterSnapshot(
            "prefix+if(width<20 mm; 'Short'; 'Long')",
            'Text',
            TextValue('AShort'),
            {'prefix', 'width'},
        ),
        'label': ParameterSnapshot("caption+'!'", 'Text', TextValue('AShort!'), {'caption'}),
    }
    update = plan_batch_snapshot('width=30', snapshot, 'mm')
    assert [(op.name, op.quantity.value) for op in update] == [('width', 30)]
    operations = plan_batch_snapshot('width=30;copy=label', snapshot, 'mm')
    assert [(op.name, op.quantity.value) for op in operations] == [
        ('width', 30),
        ('copy', 'ALong!'),
    ]


def test_existing_text_descendants_count_towards_aggregate_limit():
    snapshot = {'caption': ParameterSnapshot("''", 'Text', TextValue(''), set())}
    snapshot.update(
        {
            f'label{i}': ParameterSnapshot('caption', 'Text', TextValue(''), {'caption'})
            for i in range(64)
        }
    )
    with pytest.raises(ExpressionError, match='Combined text'):
        plan_batch_snapshot("caption='" + 'x' * 4096 + "'", snapshot, 'mm')
