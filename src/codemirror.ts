/** CodeMirror 6 adapter; the pure symbol engine is UI-independent. */
import { autocompletion, pickedCompletion, startCompletion } from '@codemirror/autocomplete';
import type { Completion, CompletionSource } from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';
import {
  builtinCompletions,
  expressionSignatureHelp,
} from '../frontend/src/expression-codemirror.ts';
import { statementStart } from './expression-language.ts';
import { ParameterIndex, suggestCompletions } from './intellisense.js';

export function parameterCompletionSource(
  getIndex: () => ParameterIndex,
  batch = false,
): CompletionSource {
  return (context) => {
    const result = suggestCompletions(
      context.state.doc.toString(),
      context.pos,
      getIndex(),
      context.explicit,
    );
    if (!result) return null;
    const text = context.state.doc.toString();
    const start = statementStart(text, context.pos);
    const before = text.slice(start, context.pos);
    const nameContext =
      !before.includes('=') && (batch || /(?<![<>=])=(?!=)/.test(text.slice(start)));
    const memberContext = text[result.from - 1] === '.';
    return {
      from: result.from,
      to: result.to,
      options: [
        ...result.options.map((symbol) => {
          const isNamespace = symbol.kind === 'namespace';
          const completion: Completion = {
            label: symbol.label,
            type: isNamespace ? 'namespace' : 'variable',
            boost: isNamespace
              ? 90
              : symbol.path === symbol.nativeName && symbol.label.includes('_')
                ? -40
                : 10,
            detail: isNamespace
              ? 'Object'
              : [
                  symbol.nativeName,
                  symbol.unit,
                  symbol.value == null ? undefined : String(symbol.value),
                ]
                  .filter(Boolean)
                  .join(' · '),
            info: symbol.comment,
          };
          if (isNamespace) {
            completion.apply = (view, option, from, to) => {
              view.dispatch({
                changes: { from, to, insert: symbol.label + '.' },
                annotations: pickedCompletion.of(option),
              });
              startCompletion(view);
            };
          }
          return completion;
        }),
        ...(!nameContext && !memberContext
          ? builtinCompletions().filter((item) => !getIndex().nativeName(item.label))
          : []),
      ],
    };
  };
}
/** Add this extension to Paramood's future CodeMirror expression editor. */
export function parameterAutocomplete(getIndex: () => ParameterIndex, batch = false): Extension {
  return [
    expressionSignatureHelp,
    autocompletion({
      override: [parameterCompletionSource(getIndex, batch)],
      activateOnTyping: true,
    }),
  ];
}
