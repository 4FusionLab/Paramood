import hashlib
import json
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_release_package_is_self_contained_and_reproducible(tmp_path):
    builder = ROOT / 'scripts' / 'build_release.py'
    subprocess.run([sys.executable, str(builder), '--output-dir', str(tmp_path)], cwd=ROOT, check=True)
    package = tmp_path / 'Paramood-1.0.0.zip'
    checksum = tmp_path / 'Paramood-1.0.0.zip.sha256'
    data = package.read_bytes()
    assert checksum.read_text().split()[0] == hashlib.sha256(data).hexdigest()
    with zipfile.ZipFile(package) as archive:
        names = set(archive.namelist())
        assert 'Paramood/Paramood.py' in names
        assert 'Paramood/Paramood.manifest' in names
        assert 'Paramood/core/expressions.py' in names
        assert 'Paramood/frontend/dist/index.html' in names
        assert any(name.startswith('Paramood/frontend/dist/assets/') and name.endswith('.js') for name in names)
        assert not any('__pycache__' in name or 'node_modules' in name for name in names)
        manifest = json.loads(archive.read('Paramood/Paramood.manifest'))
        assert manifest['version'] == '1.0.0'
        assert manifest['supportedOS'] == 'windows|mac'
    subprocess.run([sys.executable, str(builder), '--output-dir', str(tmp_path)], cwd=ROOT, check=True)
    assert package.read_bytes() == data


def test_packaged_addin_imports_under_its_release_name(tmp_path, monkeypatch):
    import importlib
    import types

    subprocess.run([sys.executable, str(ROOT / 'scripts/build_release.py'), '--output-dir', str(tmp_path)], cwd=ROOT, check=True)
    with zipfile.ZipFile(tmp_path / 'Paramood-1.0.0.zip') as archive:
        archive.extractall(tmp_path)
    adsk = types.ModuleType('adsk')
    core = types.ModuleType('adsk.core')
    fusion = types.ModuleType('adsk.fusion')
    for name in ('HTMLEventHandler', 'CommandEventHandler', 'CommandCreatedEventHandler',
                 'DocumentEventHandler', 'WorkspaceEventHandler', 'UserInterfaceGeneralEventHandler',
                 'ApplicationCommandEventHandler'):
        setattr(core, name, type(name, (), {}))
    adsk.core, adsk.fusion = core, fusion
    for name, module in [('adsk', adsk), ('adsk.core', core), ('adsk.fusion', fusion)]:
        monkeypatch.setitem(sys.modules, name, module)
    monkeypatch.syspath_prepend(str(tmp_path))
    module = importlib.import_module('Paramood.Paramood')
    assert module.FusionAdapter.__module__ == 'Paramood.fusion.adapter'
    assert (Path(module.__file__).parent / 'frontend/dist/index.html').is_file()


def test_release_version_override_is_packaged_without_changing_source(tmp_path):
    source = ROOT / 'ParaMod/ParaMod.manifest'
    original = source.read_bytes()
    subprocess.run([sys.executable, str(ROOT / 'scripts/build_release.py'), '--output-dir', str(tmp_path), '--version', '1.2.3'], cwd=ROOT, check=True)
    with zipfile.ZipFile(tmp_path / 'Paramood-1.2.3.zip') as archive:
        assert json.loads(archive.read('Paramood/Paramood.manifest'))['version'] == '1.2.3'
    assert source.read_bytes() == original


def test_release_version_override_rejects_prerelease(tmp_path):
    result = subprocess.run([sys.executable, str(ROOT / 'scripts/build_release.py'), '--output-dir', str(tmp_path), '--version', '1.2.3-beta'], cwd=ROOT, capture_output=True)
    assert result.returncode != 0
    assert not list(tmp_path.glob('*.zip'))
