"""Fusion loads Paramood as a package; unrelated add-ins may own common names."""
import importlib
import sys
import types


def test_fusion_entry_import_ignores_other_addins_common_module_names(monkeypatch):
    adsk = types.ModuleType('adsk')
    core = types.ModuleType('adsk.core')
    fusion = types.ModuleType('adsk.fusion')
    for name in ('HTMLEventHandler', 'CommandEventHandler', 'CommandCreatedEventHandler', 'DocumentEventHandler', 'WorkspaceEventHandler', 'UserInterfaceGeneralEventHandler', 'ApplicationCommandEventHandler'):
        setattr(core, name, type(name, (), {}))
    adsk.core, adsk.fusion = core, fusion
    for name, module in [('adsk', adsk), ('adsk.core', core), ('adsk.fusion', fusion)]:
        monkeypatch.setitem(sys.modules, name, module)
    for name in ('core', 'bridge', 'fusion'):
        monkeypatch.setitem(sys.modules, name, types.ModuleType(name))
    try:
        module = importlib.import_module('Paramood.Paramood')
        assert module.FusionAdapter.__module__ == 'Paramood.fusion.adapter'
    finally:
        sys.modules.pop('Paramood.Paramood', None)
        sys.modules.pop('Paramood.fusion.adapter', None)
