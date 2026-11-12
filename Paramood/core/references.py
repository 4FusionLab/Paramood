"""Quote-aware reference paths; native dependency data remains authoritative."""

import re
from collections import deque

from .text import segments


def expression_references(expression, names):
    return {
        match.group()
        for quoted, code in segments(expression)
        if not quoted
        for match in re.finditer(r'\b[^\W\d]\w*\b', code)
        if match.group() in names
    }


def reference_paths(source, expressions, dependencies):
    """Find shortest explicit paths, excluding transitive entries in native lists."""
    dependents = {name: [] for name in expressions}
    for name, expression in expressions.items():
        for dependency in expression_references(expression, expressions) & dependencies[name]:
            dependents[dependency].append(name)
    paths = {source: [source]}
    pending = deque([source])
    while pending:
        current = pending.popleft()
        for name in sorted(dependents[current]):
            if name not in paths:
                paths[name] = [*paths[current], name]
                pending.append(name)
    return paths
