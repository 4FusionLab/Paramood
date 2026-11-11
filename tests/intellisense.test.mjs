import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ParameterIndex,
  compileExpression,
  displayExpression,
  resolveParameterTarget,
  suggestCompletions,
} from '../src/intellisense.ts';

const index = new ParameterIndex([
  { name: 'box_size', unit: 'mm', value: 20 },
  { name: 'box_width', unit: 'mm', value: 30 },
  { name: 'box_wall_thickness', unit: 'mm', value: 2 },
  { name: 'box', unit: 'mm', value: 4 },
  { name: 'height', unit: 'mm', value: 40 },
]);

test('root groups first, native identifiers stay accessible', () => {
  const result = suggestCompletions('b', 1, index);
  assert.ok(result);
  assert.equal(result.options[0].label, 'box');
  assert.equal(result.options[0].kind, 'namespace');
  assert.ok(result.options.some((item) => item.label === 'box_size'));
});
test('dot offers direct child parameters and replacement range', () => {
  const result = suggestCompletions('box.', 4, index);
  assert.deepEqual(
    result?.options.map((x) => x.label),
    ['wall', 'size', 'width'],
  );
  assert.deepEqual([result?.from, result?.to], [4, 4]);
  assert.deepEqual(
    suggestCompletions('2 * box.si', 10, index)?.options.map((x) => x.label),
    ['size'],
  );
});
test('nested symbols retain unit metadata', () => {
  assert.equal(index.nativeName('box.wall.thickness'), 'box_wall_thickness');
  const result = suggestCompletions('box.wall.', 9, index);
  assert.deepEqual(
    result?.options.map((x) => x.label),
    ['thickness'],
  );
  assert.equal(result?.options[0].unit, 'mm');
});
test('expression compiler preserves native syntax and decodes existing formulas', () => {
  assert.deepEqual(compileExpression('box.size * 2 + box.wall.thickness', index), {
    expression: 'box_size * 2 + box_wall_thickness',
    diagnostics: [],
  });
  assert.equal(compileExpression('box_size + height', index).expression, 'box_size + height');
  assert.equal(displayExpression('box_size + 10 mm', index), 'box.size + 10 mm');
});
test('string literals, decimals, scientific notation and functions are unchanged', () => {
  const expr = "if (box.size < 1.25e-3 mm; 'box.size'; sin(30 deg))";
  assert.equal(
    compileExpression(expr, index).expression,
    "if (box_size < 1.25e-3 mm; 'box.size'; sin(30 deg))",
  );
  assert.equal(suggestCompletions("'box.s'", 6, index), null);
});
test('unknown paths and namespace values are rejected', () => {
  assert.deepEqual(
    compileExpression('box.foo + box.wall + 2', index).diagnostics.map((x) => x.code),
    ['unknown-path', 'namespace-as-value'],
  );
  assert.deepEqual(compileExpression('box + box.size', index).diagnostics, []);
});
test('explicit alias overrides the underscore convention', () => {
  const mapped = new ParameterIndex([{ name: 'box_wall_thickness' }], {
    box_wall_thickness: 'box.wall_thickness',
  });
  assert.equal(mapped.nativeName('box.wall_thickness'), 'box_wall_thickness');
  assert.deepEqual(
    suggestCompletions('box.', 4, mapped)?.options.map((x) => x.label),
    ['wall_thickness'],
  );
  assert.equal(displayExpression('box_wall_thickness', mapped), 'box.wall_thickness');
});
test('collisions and invalid aliases fail explicitly', () => {
  assert.throws(
    () => new ParameterIndex([{ name: 'a_b' }, { name: 'a__b' }], { a__b: 'a.b' }),
    /collision/,
  );
  assert.throws(
    () => new ParameterIndex([{ name: 'a_b' }], { a_b: 'a..b' }),
    /Invalid virtual path/,
  );
});
test('no suggestions for numbers or invalid caret', () => {
  assert.equal(suggestCompletions('10.5', 4, index), null);
  assert.equal(suggestCompletions('box.', 100, index), null);
});
test('new target paths map to native names and catch alias collisions', () => {
  assert.deepEqual(resolveParameterTarget('box.newWidth', index), {
    nativeName: 'box_newWidth',
    diagnostics: [],
  });
  assert.deepEqual(resolveParameterTarget('box.size', index), {
    nativeName: 'box_size',
    diagnostics: [],
  });
  assert.deepEqual(resolveParameterTarget('box_wall_thickness', index), {
    nativeName: 'box_wall_thickness',
    diagnostics: [],
  });
  const aliased = new ParameterIndex([{ name: 'box_wall_thickness' }], {
    box_wall_thickness: 'box.wall_thickness',
  });
  assert.equal(
    resolveParameterTarget('box.wall.thickness', aliased).diagnostics[0].code,
    'name-collision',
  );
  assert.equal(resolveParameterTarget('box..size', index).diagnostics[0].code, 'invalid-target');
});
test('leading and repeated underscores remain usable as native identifiers', () => {
  const data = new ParameterIndex([{ name: '_internal' }, { name: 'box__size' }]);
  assert.equal(data.nativeName('_internal'), '_internal');
  assert.equal(data.nativeName('box__size'), 'box__size');
});
test('explicit Ctrl+Space can offer root suggestions without prefix', () => {
  assert.equal(suggestCompletions('2 + ', 4, index), null);
  assert.equal(suggestCompletions('2 + ', 4, index, true)?.options[0].label, 'box');
});

test('supports Cyrillic hierarchical names in completion and expressions', () => {
  const index = new ParameterIndex([{ name: 'корпус_ширина' }]);
  assert.equal(suggestCompletions('корпус.ш', 8, index).options[0].label, 'ширина');
  assert.equal(compileExpression('корпус.ширина', index).expression, 'корпус_ширина');
});

// Catalog-driven coverage makes newly documented builtins part of the contract.
const { fusionFunctions, fusionConstants } = await import('../src/expression-catalog.ts');
const { expressionTokens, signatureContext, expressionDiagnostics, statementStart } =
  await import('../src/expression-language.ts');
for (const f of fusionFunctions) {
  test(`Fusion catalog and signature: ${f.name}`, () => {
    assert.equal(f.arity, f.arguments.length);
    assert.equal(f.signature, `${f.name}(${f.arguments.map((a) => a.name).join('; ')})`);
    assert.ok(f.description && f.example && f.returns);
    const text = `${f.name}(`;
    assert.equal(signatureContext(text, text.length)?.fn.name, f.name);
    assert.equal(signatureContext(text, text.length)?.argument, 0);
    assert.deepEqual(expressionDiagnostics(f.example, new Map()), []);
  });
}
for (const c of fusionConstants) {
  test(`Fusion constant: ${c.name}`, () => {
    assert.ok(c.description && c.example && c.dimension);
    assert.ok(Number.isFinite(c.value));
    assert.equal(expressionTokens(c.name)[0].kind, 'identifier');
    assert.deepEqual(expressionDiagnostics(c.example, new Map()), []);
  });
}
test('nested signatures follow the nearest open call and skip grouping and strings', () => {
  const text = 'pow(2; max(3; 4))';
  assert.equal(signatureContext(text, text.indexOf('3'))?.fn.name, 'max');
  assert.equal(signatureContext(text, text.indexOf('4'))?.argument, 1);
  assert.equal(signatureContext(text, text.length - 1)?.fn.name, 'pow');
  assert.equal(signatureContext(text, text.length), null);
  assert.equal(signatureContext('if(1<2; "a;b', 12), null);
  assert.equal(signatureContext('pow((2+3', 8)?.fn.name, 'pow');
  assert.equal(signatureContext('if(1<2; "a;b"; ', 15)?.argument, 2);
});
test('semicolons inside calls are not batch separators', () => {
  const text = 'first=2; second=pow(2; max(3; ';
  assert.equal(statementStart(text, text.length), 8);
});
test('diagnostics are conservative about incomplete input and precise about completed errors', () => {
  for (const text of ['pow(', 'pow(2;', 'somePrefix', 'sin(3', '1e-3', 'if(1<2; "unterminated'])
    assert.deepEqual(expressionDiagnostics(text, new Map()), [], text);
  for (const [text, code] of [
    ['unknown(2)', 'function'],
    ['pow(2)', 'arity'],
    ['sin(2 mm)', 'dimension'],
    ['min(2 mm; 3 deg)', 'dimension'],
    ['missing + 1', 'parameter'],
    ['2 wrongUnit + 1', 'unit'],
    ['pow(2,3)', 'separator'],
    [')', 'parenthesis'],
    ['PI()', 'constant'],
    ['1 != 2', 'operator'],
    ['if(1<2;1 mm;2 deg)', 'dimension'],
  ])
    assert.ok(
      expressionDiagnostics(text, new Map()).some((d) => d.code === code),
      text,
    );
  assert.deepEqual(expressionDiagnostics('box.size=2; width=box.size*2', new Map(), true), []);
});

const { incompleteExpression } = await import('../src/expression-language.ts');
test('native preview waits for complete expressions', () => {
  for (const input of ['probe=po', 'probe=pow()', 'pow(', 'pow(2;)', '1 +', 'if(1<2; "draft'])
    assert.equal(incompleteExpression(input), true, input);
  for (const input of ['probe=pow(2;3)', 'random()', 'PI', 'min(1;2)', '2+3'])
    assert.equal(incompleteExpression(input), false, input);
});

test('native quote and symbol units do not start text literals', () => {
  for (const [source, unit] of [
    ['1"', 'in'],
    ["1'", 'ft'],
    ['2 µ', 'micron'],
    ['30 °', 'deg'],
  ]) {
    const tokens = expressionTokens(source);
    assert.equal(tokens.at(-1).value, unit);
    assert.equal(tokens.at(-1).kind, 'identifier');
    assert.equal(incompleteExpression(source), false);
  }
  assert.equal(expressionTokens(JSON.stringify('1"'))[0].kind, 'string');
  assert.equal(
    expressionDiagnostics('2 centimeter + 1 cm', new Map()).some((d) => d.severity !== 'info'),
    false,
  );
  assert.deepEqual(expressionDiagnostics('if(1<2;1 mm;2)', new Map()), []);
  assert.deepEqual(expressionDiagnostics('floor(1 mm)', new Map()), []);
});

test('unit completion waits for a typed unit prefix after a value', async () => {
  const { unitCompletionFrom } = await import('../src/expression-language.ts');
  for (const text of ['25', '25 ', 'test=25', 'test=25 ', '.5', '1e-3', '(2+3)', '(2+3) ']) {
    assert.equal(unitCompletionFrom(text, text.length), null, text);
  }
  for (const text of ['25m', '25 m', 'test=25m', 'test=25 m', '.5 m', '1e-3 m', '(2+3) m']) {
    assert.equal(unitCompletionFrom(text, text.length), text.length - 1, text);
  }
});
