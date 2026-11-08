#!/usr/bin/env python3
"""Build a deterministic, self-contained Paramood Fusion add-in archive."""

import argparse
import hashlib
import json
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'Paramood'
FRONTEND = ROOT / 'frontend' / 'dist'


def build(output_dir: Path, version_override: str = None) -> Path:
    manifest = json.loads((SOURCE / 'Paramood.manifest').read_text(encoding='utf-8'))
    version = version_override if version_override is not None else manifest.get('version', '')
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('Manifest version must be a stable semantic version')
    if manifest.get('supportedOS') != 'windows|mac':
        raise ValueError('Manifest must support both Windows and macOS')
    html = FRONTEND / 'index.html'
    if not html.is_file():
        raise ValueError('Build frontend before creating the release package')
    html_text = html.read_text(encoding='utf-8')
    references = re.findall(r'(?:src|href)="\./(assets/[^"?#]+)', html_text)
    if not references or not all((FRONTEND / path).is_file() for path in references):
        raise ValueError('Built frontend has missing local assets')
    files = {}
    for path in SOURCE.rglob('*.py'):
        if '__pycache__' not in path.parts:
            relative = path.relative_to(SOURCE).as_posix()
            files['Paramood/' + relative] = path.read_bytes()
    files['Paramood/core/expression_catalog.json'] = (
        SOURCE / 'core' / 'expression_catalog.json'
    ).read_bytes()
    files['Paramood/LICENSE'] = (ROOT / 'LICENSE').read_bytes()
    files['Paramood/THIRD_PARTY_NOTICES.txt'] = (ROOT / 'THIRD_PARTY_NOTICES.txt').read_bytes()
    manifest['version'] = version
    files['Paramood/Paramood.manifest'] = (
        json.dumps(manifest, ensure_ascii=False, indent=2) + '\n'
    ).encode('utf-8')
    for path in FRONTEND.rglob('*'):
        if path.is_file():
            files['Paramood/frontend/dist/' + path.relative_to(FRONTEND).as_posix()] = (
                path.read_bytes()
            )
    output_dir.mkdir(parents=True, exist_ok=True)
    package = output_dir / ('Paramood-' + version + '.zip')
    with zipfile.ZipFile(
        package, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9
    ) as archive:
        for name, content in sorted(files.items()):
            info = zipfile.ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, content, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    digest = hashlib.sha256(package.read_bytes()).hexdigest()
    (output_dir / (package.name + '.sha256')).write_text(
        digest + '  ' + package.name + '\n', encoding='ascii'
    )
    return package


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'dist')
    parser.add_argument('--version', help='Stable release version to embed in the package')
    args = parser.parse_args()
    print(build(args.output_dir, args.version))
