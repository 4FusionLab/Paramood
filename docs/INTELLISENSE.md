# Paramood IntelliSense — virtual parameter objects

**Status:** the TypeScript core is integrated into the Fusion palette. The main input, inline editors, and variant parameter search use parameter completion. See the [user guide](USER_GUIDE.md) for end-user workflows.

| Native Fusion name | Paramood virtual path |
| --- | --- |
| `box_size` | `box.size` |
| `box_width` | `box.width` |
| `box_wall_thickness` | `box.wall.thickness` |

Typing `b` prioritizes the `box` namespace; selecting it inserts `box.` and triggers member completion. `box.` exposes `wall`, `size`, `width`, while `box.wall.` exposes `thickness`. CodeMirror provides arrow keys, Enter, Escape, and explicit Ctrl+Space.

Default mapping splits each single underscore into a path segment, with flat fallback for leading/trailing/doubled underscores. Original Fusion names remain available. The core API accepts explicit per-parameter aliases such as `{ "box_wall_thickness": "box.wall_thickness" }` which override inference without renaming Fusion parameters. The palette does not currently expose a per-design alias editor. Path collisions and unresolvable dotted references are diagnosed.

Editor expression `box.size * box.width` compiles to `box_size * box_width`; reading from Fusion reverses this translation. New definition targets are resolved with `resolveParameterTarget` (e.g. `box.volume` → `box_volume`). Strings, numeric literals and unknown native functions are preserved.

```ts
import { ParameterIndex, compileExpression, displayExpression, resolveParameterTarget } from './src/intellisense.js';
import { parameterAutocomplete } from './src/codemirror.js';
const index = new ParameterIndex(fusionParameters, aliasesByNativeName);
const extensions = [parameterAutocomplete(() => index)];
const target = resolveParameterTarget('box.volume', index);
const rhs = compileExpression('box.size * box.width', index);
// Only after no diagnostics, send target.nativeName and rhs.expression to the Fusion bridge.
```

**Integration boundary:** the core does not evaluate Fusion expressions or validate units, cycles, writable parameters, or model dependencies. The Python planning layer and Fusion adapter perform these checks and revalidate before writes. The palette refreshes its parameter index from the active model. Alias persistence is not an exposed product feature.

Quoted content is preserved: a parameter name inside `'box.width'` remains text. Quoted semicolons and equals signs do not divide a batch or start an assignment. Text expressions retain their source formula when edited; see [text parameter input](USER_GUIDE.md#text-parameters).

The variant search accepts one existing-parameter assignment such as `box.width=30`. It selects the parameter and updates the draft using the target parameter's units for bare numeric literals. The model changes only on **Save & apply**.

Run root `npm test` for the standalone index and `npm test --prefix frontend` for palette integration tests. These automated checks do not establish native Fusion or Windows behavior.

[Russian details](INTELLISENSE.ru.md)
