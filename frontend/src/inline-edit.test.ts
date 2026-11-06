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
});
