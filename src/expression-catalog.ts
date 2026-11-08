/** Fusion expression metadata shared by completion, highlighting and signature help. */
import catalog from '../Paramood/core/expression_catalog.json' with { type: 'json' };
export interface FunctionArgument {
  name: string;
  description: string;
  type: string;
  dimension: string;
}
export interface FusionFunction {
  name: string;
  category: string;
  description: string;
  signature: string;
  arguments: FunctionArgument[];
  arity: number;
  returns: string;
  example: string;
  restriction: string;
}
export const fusionFunctions: readonly FusionFunction[] = catalog.functions;
export const fusionConstants = catalog.constants;
export const fusionUnits: readonly string[] = [...catalog.units, 'n'];
export const fusionOperators = catalog.operators;
export const functionByName = new Map(fusionFunctions.map((f) => [f.name, f]));
export const constantByName = new Map(fusionConstants.map((c) => [c.name, c]));
export function functionInfo(f: FusionFunction): string {
  return `${f.description}\n${f.arguments.map((a) => `${a.name}: ${a.type} — ${a.description}`).join('\n')}\nReturns: ${f.returns}. ${f.restriction}\nExample: ${f.example}`;
}
