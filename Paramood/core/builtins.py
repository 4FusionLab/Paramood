"""Fusion's canonical expression metadata. No Autodesk imports are allowed here."""

import json
from pathlib import Path

CATALOG = json.loads(
    Path(__file__).with_name('expression_catalog.json').read_text(encoding='utf-8')
)
FUNCTIONS = {item['name']: item for item in CATALOG['functions']}
CONSTANT_NAMES = {item['name'] for item in CATALOG['constants']}
UNIT_NAMES = set(CATALOG['units']) | {
    alias for unit in CATALOG['unitDefinitions'] for alias in unit['aliases']
}
