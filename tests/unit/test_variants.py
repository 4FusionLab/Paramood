import json

import pytest

from Paramood.core.variants import (
    decode_variants,
    encode_variants,
    values_match,
    variants_token,
    decode_variant_table,
)


def variant():
    return {
        'id': 'compact',
        'name': 'Компактный',
        'parameters': [
            {
                'name': 'width',
                'entityToken': 'token',
                'expression': '10 mm',
                'unit': 'mm',
                'value': 1.0,
            }
        ],
    }


def columns():
    return [{'kind': 'parameter', 'name': 'width', 'entityToken': 'token', 'unit': 'mm'}]


def test_roundtrip_unicode_and_many_variants():
    variants = [{**variant(), 'id': str(index), 'name': str(index)} for index in range(1000)]
    assert decode_variants(encode_variants(variants, columns())) == variants
    assert decode_variants('') == []
    assert variants_token('') != variants_token(encode_variants([], []))


@pytest.mark.parametrize(
    'data', [None, [], {}, {'version': 1, 'variants': []}, {'version': 1, 'variants': [{}]}]
)
def test_invalid_data_is_not_treated_as_empty(data):
    with pytest.raises(ValueError):
        decode_variants(json.dumps(data))


@pytest.mark.parametrize('mutation', ['duplicate_id', 'duplicate_name', 'empty', 'nan', 'token'])
def test_invalid_records_rejected(mutation):
    item = variant()
    items = [item]
    if mutation == 'duplicate_id':
        items.append({**variant(), 'name': 'Other'})
    elif mutation == 'duplicate_name':
        items.append({**variant(), 'id': 'other'})
    elif mutation == 'empty':
        item['parameters'] = []
    elif mutation == 'nan':
        item['parameters'][0]['value'] = float('nan')
    else:
        item['parameters'][0]['entityToken'] = ''
    with pytest.raises(ValueError):
        encode_variants(items, columns())


def test_numeric_comparison_has_small_tolerance_and_rejects_nan():
    assert values_match(1.00000000001, 1)
    assert not values_match(1.01, 1)
    assert not values_match(float('nan'), 1)


def test_table_requires_every_row_to_have_the_same_ordered_set():
    item = variant()
    item['parameters'] = []
    with pytest.raises(ValueError, match='same ordered'):
        encode_variants([item], columns())


def test_feature_only_variants_and_interleaved_column_order_round_trip():
    feature = {'kind': 'feature', 'name': 'Cut', 'entityToken': 'cut'}
    item = variant()
    item['features'] = [{'name': 'Cut', 'entityToken': 'cut', 'enabled': False}]
    configured = [feature] + columns()
    raw = encode_variants([item], configured)
    assert decode_variant_table(raw)['columns'] == configured
    assert not decode_variants(raw)[0]['features'][0]['enabled']
    item['parameters'] = []
    assert decode_variants(encode_variants([item], [feature])) == [item]


def test_no_legacy_format_or_migration():
    with pytest.raises(ValueError, match='Unsupported'):
        decode_variant_table(json.dumps({'version': 1, 'variants': [variant()]}))
    assert decode_variant_table('') == {'version': 2, 'columns': [], 'variants': []}
