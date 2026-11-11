import type { Completion } from '@codemirror/autocomplete';
import { pickedCompletion } from '@codemirror/autocomplete';
import { StateField } from '@codemirror/state';
import { showTooltip, type Tooltip } from '@codemirror/view';
import {
  fusionFunctions,
  fusionConstants,
  fusionUnits,
  fusionOperators,
  functionInfo,
} from '../../src/expression-catalog.ts';
import { signatureContext } from '../../src/expression-language.ts';

export function unitCompletions(): Completion[] {
  return fusionUnits.map((label): Completion => ({
    label,
    type: 'keyword',
    detail: label === 'n' ? 'Paramood unitless suffix' : 'Fusion unit',
  }));
}
export function builtinCompletions(): Completion[] {
  return [
    ...fusionFunctions.map((f): Completion => ({
      label: f.name,
      type: 'function',
      detail: f.signature,
      info: functionInfo(f),
      apply(view, completion, from, to) {
        const following = view.state.sliceDoc(to).match(/^\s*\(/);
        const insert = f.name + (following ? '' : '()');
        view.dispatch({
          changes: { from, to, insert },
          selection: { anchor: from + f.name.length + (following ? following[0].length : 1) },
          annotations: pickedCompletion.of(completion),
        });
      },
    })),
    ...fusionConstants.map((c): Completion => ({
      label: c.name,
      type: 'constant',
      detail: `${c.value} ${c.unit || 'unitless'}`,
      info: `${c.description}\nDimension: ${c.dimension}. Case-sensitive.\nExample: ${c.example}`,
    })),
    ...fusionOperators
      .filter((operator) => /^[a-z]+$/.test(operator))
      .map((label): Completion => ({ label, type: 'keyword', detail: 'Logical operator' })),
  ];
}
export const expressionSignatureHelp = StateField.define<readonly Tooltip[]>({
  create: (state) => signatureTooltips(state.doc.toString(), state.selection.main.head),
  update(value, tr) {
    return tr.docChanged || tr.selection
      ? signatureTooltips(tr.state.doc.toString(), tr.state.selection.main.head)
      : value;
  },
  provide: (field) => showTooltip.computeN([field], (state) => state.field(field)),
});
function signatureTooltips(text: string, pos: number): readonly Tooltip[] {
  const context = signatureContext(text, pos);
  if (!context) return [];
  return [
    {
      pos,
      above: true,
      create: () => {
        const dom = document.createElement('div');
        dom.className = 'expression-signature';
        const signature = document.createElement('div');
        signature.className = 'expression-signature-label';
        signature.append(context.fn.name + '(');
        context.fn.arguments.forEach((arg, i) => {
          if (i) signature.append('; ');
          const span = document.createElement(i === context.argument ? 'strong' : 'span');
          span.textContent = arg.name;
          if (i === context.argument) span.className = 'expression-active-argument';
          signature.append(span);
        });
        signature.append(')');
        dom.append(signature);
        const description = document.createElement('div');
        description.textContent = context.fn.description;
        dom.append(description);
        context.fn.arguments.forEach((arg, i) => {
          const row = document.createElement('div');
          row.textContent = `${arg.name}: ${arg.type} — ${arg.description}`;
          if (i === context.argument) row.className = 'expression-active-argument';
          dom.append(row);
        });
        const returns = document.createElement('div');
        returns.textContent = `Returns: ${context.fn.returns}. ${context.fn.restriction}`;
        dom.append(returns);
        const example = document.createElement('div');
        example.textContent = `Example: ${context.fn.example}`;
        dom.append(example);
        dom.setAttribute('role', 'note');
        return { dom };
      },
    },
  ];
}
