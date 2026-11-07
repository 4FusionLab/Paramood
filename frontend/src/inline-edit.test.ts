import { describe, expect, it } from 'vitest';
import { prepareInlineEdit } from './inline-edit';

const width = {
  name: 'width',
  expression: '10 mm',
  value: '10 mm',
  unit: 'mm',
  kind: 'user' as const,
  valueExpression: '1.2345678901234567 cm',
};
describe('inline parameter edits', () => {
  it('sends an equation with an expression on the left for solving', () => {
    expect(prepareInlineEdit(width, '-length/5=50', [width])).toEqual({
      text: '',
      equation: '-length/5=50',
    });
  });
  it('creates an unknown bare name from the precise current value', () => {
    expect(prepareInlineEdit(width, 'box.size', [width])).toEqual({
      text: 'box.size=1.2345678901234567 cm;width=box.size',
      newName: 'box_size',
      sourceValueExpression: '1.2345678901234567 cm',
    });
  });
  it('keeps existing names and reserved words as expressions', () => {
    expect(prepareInlineEdit(width, 'height', [width, { ...width, name: 'height' }])).toEqual({
      text: 'width=height',
    });
    expect(prepareInlineEdit(width, 'this', [width])).toEqual({ text: 'width=this' });
  });
  it('refuses to guess the current value when it is unavailable', () => {
    expect(() =>
      prepareInlineEdit({ ...width, valueExpression: undefined }, 'x', [width]),
    ).toThrow();
  });
  it('creates and links a new parameter using the edited parameter unit', () => {
    expect(prepareInlineEdit(width, 'x=25', [width])).toEqual({
      text: 'x=25 mm;width=x',
      newName: 'x',
    });
  });
  it('supports hierarchical names and explicit expressions', () => {
    expect(prepareInlineEdit(width, 'box.size=height*2', [width])).toEqual({
      text: 'box.size=height*2;width=box.size',
      newName: 'box_size',
    });
  });
  it('does not overwrite an existing parameter', () => {
    expect(() =>
      prepareInlineEdit(width, 'height=25', [width, { ...width, name: 'height' }]),
    ).toThrow();
  });
  it('preserves scalar dimension for a new numeric parameter', () => {
    expect(prepareInlineEdit({ ...width, unit: '' }, 'count=25', [width])).toEqual({
      text: 'count=25n;width=count',
      newName: 'count',
    });
  });
  it.each(['6', '-2.5', '1e3', '6 n', 'this+2', 'post*2'])(
    'preserves an existing scalar while editing %s beside its child parameters',
    (input) => {
      const post = { ...width, name: 'post', unit: '', expression: '4', value: '4' };
      const parameters = [post, { ...width, name: 'post_height' }, { ...width, name: 'post_size' }];
      const expected = ['6', '-2.5', '1e3'].includes(input) ? `${input} n` : input;
      expect(prepareInlineEdit(post, input, parameters)).toEqual({ text: `post=${expected}` });
    },
  );
});

it('edits text expressions and quoted separators without creating or linking a new variable', () => {
  const text = {
    ...width,
    name: 'caption',
    unit: 'Text',
    valueType: 'text' as const,
    value: 'Body',
    expression: "prefix+'Body'",
  };
  expect(prepareInlineEdit(text, "'a=b;c'", [text])).toEqual({ text: "caption='a=b;c'" });
  expect(prepareInlineEdit(text, "prefix+'New'", [text])).toEqual({ text: "caption=prefix+'New'" });
  expect(prepareInlineEdit(text, 'unknown', [text])).toEqual({ text: 'caption=unknown' });
  expect(prepareInlineEdit(text, '30', [text])).toEqual({ text: 'caption=30' });
});
