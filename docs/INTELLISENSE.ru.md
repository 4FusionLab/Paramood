# Paramood IntelliSense — виртуальные объекты параметров

**Статус:** реализованы ядро подсказок и адаптер CodeMirror 6; Fusion HTML Palette и Python bridge ещё не интегрированы.

## Поведение

| Имя Fusion | Вид в Paramood |
| --- | --- |
| `box_size` | `box.size` |
| `box_width` | `box.width` |
| `box_wall_thickness` | `box.wall.thickness` |
| `height` | `height` |

При вводе `b` первыми предлагаются объекты, в данном случае `box`. Выбор группы автоматически вставляет `box.` и открывает подсказки дочерних элементов. При `box.` предлагаются `wall`, `size`, `width`, а при `box.wall.` — `thickness`. Навигация: стрелки, Enter, Escape и Ctrl+Space через CodeMirror.

В редакторе `box.volume = box.size * box.width * height`; при создании параметра в Fusion записываются имя `box_volume` и выражение `box_size * box_width * height`. При чтении существующего выражения выполняется обратное преобразование. В Fusion остаются обычные плоские имена — виртуальных объектов там нет.

## Правила именования

- По умолчанию каждый одиночный `_` задаёт уровень вложенности: `box_wall_thickness` → `box.wall.thickness`.
- Имена с начальным, конечным или повторным `_` остаются плоскими для сохранения совместимости.
- Плоские реальные имена `box_size` также допускаются при вводе и показываются как низкоприоритетные варианты.
- Можно явно переопределить представление: `{ "box_wall_thickness": "box.wall_thickness" }`, не меняя реальное имя Fusion.
- Группа `box` и параметр `box` могут существовать одновременно. Это разные пункты IntelliSense.
- Коллизии виртуальных путей, неизвестные dotted paths и использование группы как значения приводят к диагностике до записи.

## API и интеграция

```ts
import { ParameterIndex, compileExpression, displayExpression, resolveParameterTarget } from './src/intellisense.js';
import { parameterAutocomplete } from './src/codemirror.js';
const index = new ParameterIndex(fusionParameters, aliasesByNativeName);
const extensions = [parameterAutocomplete(() => index)];
const readable = displayExpression(nativeExpression, index);
const target = resolveParameterTarget('box.volume', index);
const rhs = compileExpression('box.size * box.width', index);
if (!target.diagnostics.length && !rhs.diagnostics.length) {
  // Передать через валидируемый JSON bridge: { name: target.nativeName, expression: rhs.expression }
  // Проверить и применить через Python/Fusion API после preview.
}
```

Левая сторона определения параметра обрабатывается `resolveParameterTarget`; правая — `compileExpression`. Никогда не отправлять virtual path напрямую в Fusion. Ядро не вычисляет формулы, не проверяет размерности, функции, циклы или разрешение на редактирование: это ответственность слоя Fusion.

## До релиза

Нужно подключить источники `userParameters` и доступных model parameters, обновление индекса, CodeMirror Palette, Python bridge, предварительную валидацию/preview и сохранение alias map в рамках конкретной модели. Поведение в Fusion пока не проверялось. Локально движок проверяется `npm test` (Node.js 22.6+).
