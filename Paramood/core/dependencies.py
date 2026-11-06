"""Conservative cleanup planning for a verified, complete dependency snapshot."""

from __future__ import annotations
from typing import Mapping, AbstractSet


def cleanup_plan(
    graph: Mapping[str, AbstractSet[str]],
    roots: AbstractSet[str],
    favorites: AbstractSet[str],
    selected: AbstractSet[str] | None = None,
) -> list[str]:
    """Return dependents before dependencies; all graph nodes must be user parameters.

    Caller must establish completeness, map every model/external dependency into
    roots, re-snapshot immediately before mutation, and reject unknown semantics.
    Unselected candidates become roots, preserving their transitive dependencies.
    """
    names = set(graph)
    if not set(roots) <= names or not set(favorites) <= names:
        raise ValueError('Unknown protected parameter')
    if any(not set(deps) <= names for deps in graph.values()):
        raise ValueError('Incomplete dependency graph')
    if selected is not None and not set(selected) <= names:
        raise ValueError('Unknown selected parameter')
    protected = set(roots) | set(favorites)
    if selected is not None:
        protected |= names - set(selected)
    stack = list(protected)
    while stack:
        name = stack.pop()
        for dep in graph[name]:
            if dep not in protected:
                protected.add(dep)
                stack.append(dep)
    candidates = names - protected
    order: list[str] = []
    temporary: set[str] = set()
    permanent: set[str] = set()

    def visit(name: str) -> None:
        if name in temporary:
            raise ValueError('Cyclic dependency graph')
        if name in permanent:
            return
        temporary.add(name)
        for dep in sorted(graph[name] & candidates):
            visit(dep)
        temporary.remove(name)
        permanent.add(name)
        order.append(name)

    for name in sorted(candidates):
        visit(name)
    return list(reversed(order))
