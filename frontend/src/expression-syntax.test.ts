import { expect, it } from 'vitest';
import {
  hasAssignment,
  hasDefinitionSeparator,
  inString,
  mapExpressionCode,
} from './expression-syntax';
it('treats quoted assignments, delimiters and identifiers as literal contents', () => {
  expect(hasAssignment("'a=b;c'")).toBe(false);
  expect(hasAssignment("caption='a=b;c'")).toBe(true);
  expect(hasDefinitionSeparator("'a=b;c'")).toBe(false);
  expect(hasDefinitionSeparator("if(width<20 mm; 'A'; 'B')")).toBe(false);
  expect(hasDefinitionSeparator("'a';'b'")).toBe(true);
  expect(inString("caption='bo")).toBe(true);
  expect(inString("caption='body'")).toBe(false);
  expect(mapExpressionCode("'this' + this", (code) => code.replace(/\bthis\b/g, 'old'))).toBe(
    "'this' + old",
  );
});
it('distinguishes comparisons in string formulas from top-level assignments', () => {
  expect(hasAssignment("if(width<=20 mm; 'Short'; 'Long')")).toBe(false);
  expect(hasAssignment("if(width==20 mm; 'Short'; 'Long')")).toBe(false);
  expect(hasAssignment("caption=if(width>=20 mm; 'Short'; 'Long')")).toBe(true);
});
it('preserves escaped quotes while scanning command delimiters', () => {
  expect(hasAssignment("'a\\'b=c'")).toBe(false);
  expect(hasAssignment('"a\\"b=c"')).toBe(false);
  expect(inString("caption='a\\'b'")).toBe(false);
  expect(mapExpressionCode("'a\\'this' + this", (code) => code.replace(/\bthis\b/g, 'old'))).toBe(
    "'a\\'this' + old",
  );
});

it('treats native inch and foot suffixes as units while preserving quoted text', () => {
  expect(hasDefinitionSeparator('size=1";other=2')).toBe(true);
  expect(hasDefinitionSeparator("size=1';other=2")).toBe(true);
  expect(inString('size=1"')).toBe(false);
  expect(inString("size=1'")).toBe(false);
  expect(inString('caption="1')).toBe(true);
});
