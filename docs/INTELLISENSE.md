# Paramood IntelliSense — virtual parameter objects

**Status:** standalone TypeScript core and CodeMirror 6 adapter implemented. Fusion HTML Palette and Python bridge integration remain future work.

| Native Fusion name | Paramood virtual path |
| --- | --- |
| `box_size` | `box.size` |
| `box_width` | `box.width` |
| `box_wall_thickness` | `box.wall.thickness` |

Typing `b` prioritizes the `box` namespace; selecting it inserts `box.` and triggers member completion. `box.` exposes `wall`, `size`, `width`, while `box.wall.` exposes `thickness`. CodeMirror provides arrow keys, Enter, Escape, and explicit Ctrl+Space.

Default mapping splits each single underscore into a path segment, with flat fallback for leading/trailing/doubled underscores. Original Fusion names remain available. Explicit per-parameter aliases such as `{ "box_wall_thickness": "box.wall_thickness" }` override inference without renaming Fusion parameters. Path collisions and unresolvable dotted references are diagnosed.

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

**Integration boundary:** the core does not evaluate Fusion expressions or validate units, cycles, writable parameters or model dependencies. The future Python/Fusion integration must validate and preview before any apply, refresh symbols from Fusion and persist aliases per design. Run `npm test` with Node.js 22.6+.

[Russian details](INTELLISENSE.ru.md)
