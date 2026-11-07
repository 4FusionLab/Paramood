"""Versioned, transport-independent storage for named parameter variants."""

import hashlib
import json
import math


def decode_variants(raw):
    if not raw:
        return []
    data = json.loads(raw)
    if not isinstance(data, dict) or data.get('version') != 1:
        raise ValueError('Unsupported variants format.')
    variants = data.get('variants')
    if not isinstance(variants, list):
        raise ValueError('Invalid variants data.')
    ids, names = set(), set()
    for variant in variants:
        if not isinstance(variant, dict):
            raise ValueError('Invalid variant.')
        identity, name = variant.get('id'), variant.get('name')
        if not isinstance(identity, str) or not identity or identity in ids:
            raise ValueError('Invalid variant identity.')
        if not isinstance(name, str) or not name.strip() or name.casefold() in names:
            raise ValueError('Invalid or duplicate variant name.')
        ids.add(identity)
        names.add(name.casefold())
        entries = variant.get('parameters')
        if not isinstance(entries, list) or not entries:
            raise ValueError('A variant needs at least one parameter.')
        tokens = set()
        for entry in entries:
            if not isinstance(entry, dict) or any(
                not isinstance(entry.get(key), str)
                for key in ('name', 'entityToken', 'expression', 'unit')
            ):
                raise ValueError('Invalid variant parameter.')
            if not entry['name'] or not entry['expression'] or not entry['entityToken']:
                raise ValueError('Missing variant parameter identity or expression.')
            if entry['entityToken'] in tokens:
                raise ValueError('Duplicate variant parameter.')
            tokens.add(entry['entityToken'])
            value = entry.get('value')
            if entry['unit'] == 'Text':
                if not isinstance(value, str):
                    raise ValueError('Invalid text variant value.')
            elif type(value) not in (float, int) or not math.isfinite(value):
                raise ValueError('Invalid variant parameter value.')
    return variants


def encode_variants(variants):
    raw = json.dumps(
        {'version': 1, 'variants': variants},
        ensure_ascii=False,
        allow_nan=False,
        separators=(',', ':'),
    )
    decode_variants(raw)
    if len(raw.encode('utf-8')) > 2097152:
        raise ValueError('Variants exceed the Fusion attribute size limit (2 MiB).')
    return raw


def variants_token(raw):
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()


def values_match(actual, expected):
    if isinstance(actual, str) or isinstance(expected, str):
        return type(actual) is str and type(expected) is str and actual == expected
    return math.isfinite(actual) and math.isclose(actual, expected, rel_tol=1e-9, abs_tol=1e-9)
