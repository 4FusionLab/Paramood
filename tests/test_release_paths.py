"""Regression contracts for Paramood's release-eligible file allowlist.

Keep these sample paths in sync with the published ZIP's actual inputs.
"""

import fnmatch
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


def releases_on(path):
    lines = (ROOT / '.github' / 'release-paths.txt').read_text(encoding='utf-8').splitlines()
    rules = [line.strip() for line in lines if line.strip() and not line.lstrip().startswith('#')]
    include = [rule for rule in rules if not rule.startswith('!')]
    exclude = [rule[1:] for rule in rules if rule.startswith('!')]
    return any(fnmatch.fnmatchcase(path, pattern) for pattern in include) and not any(
        fnmatch.fnmatchcase(path, pattern) for pattern in exclude
    )


class ReleasePathsTests(unittest.TestCase):
    def test_shipped_runtime_inputs_trigger_release(self):
        for path in (
            'Paramood/core/parameters.py',
            'Paramood/Paramood.manifest',
            'frontend/src/main.tsx',
            'frontend/src/style.css',
            'frontend/index.html',
            'frontend/package-lock.json',
            'frontend/vite.config.ts',
            'src/intellisense.ts',
            'scripts/build_release.py',
        ):
            with self.subTest(path=path):
                self.assertTrue(releases_on(path))

    def test_unshipped_sources_and_build_tests_do_not_trigger_release(self):
        for path in (
            'README.md',
            'docs/INTELLISENSE.md',
            'src/codemirror.ts',
            'package.json',
            'pyproject.toml',
            'frontend/src/bridge.test.ts',
            'frontend/src/editor.spec.tsx',
            'tests/intellisense.test.mjs',
            '.github/workflows/ci.yml',
            '.github/release-paths.txt',
        ):
            with self.subTest(path=path):
                self.assertFalse(releases_on(path))


if __name__ == '__main__':
    unittest.main()
