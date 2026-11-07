import { describe, expect, it } from 'vitest';
import { parseVariantQuery } from './variant-query';
const parameters = [
  { name: 'box_width', expression: '10 mm', value: 10, unit: 'mm', entityToken: 'width' },
  { name: 'box_height', expression: '20 mm', value: 20, unit: 'mm', entityToken: 'height' },
  { name: 'angle', expression: '30 deg', value: 30, unit: 'deg', entityToken: 'angle' },
  {
    name: 'driven',
    expression: '10 mm',
    value: 10,
    unit: 'mm',
    entityToken: 'driven',
    driven: true,
  },
];
describe('variant query parsing', () => {
  it('normalizes a dotted search without creating parameters', () => {
    expect(parseVariantQuery('box.w', parameters)).toEqual({ filter: 'box_w' });
    expect(parseVariantQuery('box.width=', parameters)).toEqual({ filter: 'box_width' });
    expect(parseVariantQuery('new=10', parameters).error).toBeTruthy();
    expect(parseVariantQuery('driven=10', parameters).error).toBeTruthy();
  });
  it('uses the target unit and compiles symbolic references', () => {
    expect(parseVariantQuery('angle=90', parameters).assignment?.expression).toBe('90 deg');
    expect(parseVariantQuery('box.width=box.height/2', parameters).assignment?.expression).toBe(
      'box_height/2',
    );
    expect(parseVariantQuery('box_width=2 cm', parameters).assignment?.expression).toBe('2 cm');
  });
  it('rejects multiple assignments and invalid reference paths', () => {
    for (const text of [
      'box.width=20;box.height=30',
      'box.width=unknown.path',
      'box.width=box',
      'box.width==20',
    ])
      expect(parseVariantQuery(text, parameters).error).toBeTruthy();
  });
});
it('resolves this against the current model value without a self reference', () => {
  const current = parameters.map((parameter) => ({ ...parameter, valueExpression: '10 mm' }));
  expect(parseVariantQuery('box.width=this*2', current).assignment?.expression).toBe('(10 mm)*2');
});
it('preserves string contents and avoids replacing literal this in text assignments', () => {
  const text = {
    name: 'caption',
    unit: 'Text',
    value: 'Body',
    valueType: 'text' as const,
    expression: "'Body'",
    entityToken: 'caption',
    valueExpression: "'Body'",
  };
  expect(parseVariantQuery("caption='this=a;b'", [text]).assignment?.expression).toBe("'this=a;b'");
});
it('accepts conditional text formulas and literal internal-looking words', () => {
  const text = {
    name: 'caption',
    unit: 'Text',
    value: 'Body',
    expression: "'Body'",
    entityToken: 'caption',
  };
  expect(parseVariantQuery("caption='__CURRENT__'", [text]).assignment?.expression).toBe(
    "'__CURRENT__'",
  );
  expect(
    parseVariantQuery("caption=if(width<=20 mm; 'Short'; 'Long')", [text, ...parameters]).assignment
      ?.expression,
  ).toBe("if(width<=20 mm; 'Short'; 'Long')");
});
