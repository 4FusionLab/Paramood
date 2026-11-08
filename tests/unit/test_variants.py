import json

import pytest

from Paramood.core.variants import decode_variants, encode_variants, values_match, variants_token


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


def test_roundtrip_unicode_and_many_variants():
    variants = [{**variant(), 'id': str(index), 'name': str(index)} for index in range(1000)]
    assert decode_variants(encode_variants(variants)) == variants
    assert decode_variants('') == []
    assert variants_token('') != variants_token(encode_variants([]))


@pytest.mark.parametrize(
    'data', [None, [], {}, {'version': 2, 'variants': []}, {'version': 1, 'variants': [{}]}]
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
        encode_variants(items)


def test_numeric_comparison_has_small_tolerance_and_rejects_nan():
    assert values_match(1.00000000001, 1)
    assert not values_match(1.01, 1)
    assert not values_match(float('nan'), 1)
