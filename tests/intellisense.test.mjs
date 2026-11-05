import test from 'node:test';
import assert from 'node:assert/strict';
import { ParameterIndex, compileExpression, displayExpression, resolveParameterTarget, suggestCompletions } from '../src/intellisense.ts';

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
  assert.ok(result.options.some(item => item.label === 'box_size'));
});
test('dot offers direct child parameters and replacement range', () => {
  const result = suggestCompletions('box.', 4, index);
  assert.deepEqual(result?.options.map(x => x.label), ['wall', 'size', 'width']);
  assert.deepEqual([result?.from, result?.to], [4, 4]);
  assert.deepEqual(suggestCompletions('2 * box.si', 10, index)?.options.map(x => x.label), ['size']);
});
test('nested symbols retain unit metadata', () => {
  assert.equal(index.nativeName('box.wall.thickness'), 'box_wall_thickness');
  const result = suggestCompletions('box.wall.', 9, index);
  assert.deepEqual(result?.options.map(x => x.label), ['thickness']);
  assert.equal(result?.options[0].unit, 'mm');
});
test('expression compiler preserves native syntax and decodes existing formulas', () => {
  assert.deepEqual(compileExpression('box.size * 2 + box.wall.thickness', index), {
    expression: 'box_size * 2 + box_wall_thickness', diagnostics: [],
  });
  assert.equal(compileExpression('box_size + height', index).expression, 'box_size + height');
  assert.equal(displayExpression('box_size + 10 mm', index), 'box.size + 10 mm');
});
test('string literals, decimals, scientific notation and functions are unchanged', () => {
  const expr = "if (box.size < 1.25e-3 mm; 'box.size'; sin(30 deg))";
  assert.equal(compileExpression(expr, index).expression,
    "if (box_size < 1.25e-3 mm; 'box.size'; sin(30 deg))");
  assert.equal(suggestCompletions("'box.s'", 6, index), null);
});
test('unknown paths and namespace values are rejected', () => {
  assert.deepEqual(compileExpression('box.foo + box.wall + 2', index).diagnostics.map(x => x.code),
    ['unknown-path', 'namespace-as-value']);
  assert.deepEqual(compileExpression('box + box.size', index).diagnostics, []);
});
test('explicit alias overrides the underscore convention', () => {
  const mapped = new ParameterIndex([{ name: 'box_wall_thickness' }],
    { box_wall_thickness: 'box.wall_thickness' });
  assert.equal(mapped.nativeName('box.wall_thickness'), 'box_wall_thickness');
  assert.deepEqual(suggestCompletions('box.', 4, mapped)?.options.map(x => x.label), ['wall_thickness']);
  assert.equal(displayExpression('box_wall_thickness', mapped), 'box.wall_thickness');
});
test('collisions and invalid aliases fail explicitly', () => {
  assert.throws(() => new ParameterIndex([{ name: 'a_b' }, { name: 'a__b' }],
    { a__b: 'a.b' }), /collision/);
  assert.throws(() => new ParameterIndex([{ name: 'a_b' }], { a_b: 'a..b' }), /Invalid virtual path/);
});
test('no suggestions for numbers or invalid caret', () => {
  assert.equal(suggestCompletions('10.5', 4, index), null);
  assert.equal(suggestCompletions('box.', 100, index), null);
});
test('new target paths map to native names and catch alias collisions', () => {
  assert.deepEqual(resolveParameterTarget('box.newWidth', index),
    { nativeName: 'box_newWidth', diagnostics: [] });
  assert.deepEqual(resolveParameterTarget('box.size', index), { nativeName: 'box_size', diagnostics: [] });
  assert.deepEqual(resolveParameterTarget('box_wall_thickness', index),
    { nativeName: 'box_wall_thickness', diagnostics: [] });
  const aliased = new ParameterIndex([{ name: 'box_wall_thickness' }],
    { box_wall_thickness: 'box.wall_thickness' });
  assert.equal(resolveParameterTarget('box.wall.thickness', aliased).diagnostics[0].code, 'name-collision');
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
