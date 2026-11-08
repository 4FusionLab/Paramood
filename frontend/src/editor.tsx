import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { Compartment, EditorState, type Range } from '@codemirror/state';
import {
  EditorView,
  keymap,
  placeholder,
  hoverTooltip,
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
  acceptCompletion,
  autocompletion,
  closeCompletion,
  completionStatus,
  pickedCompletion,
  startCompletion,
  type CompletionContext,
  type Completion,
} from '@codemirror/autocomplete';
import type { Parameter } from './bridge';
import { inString } from './expression-syntax';

import {
  functionByName,
  constantByName,
  fusionUnits,
  fusionOperators,
} from '../../src/expression-catalog';
import { builtinCompletions, expressionSignatureHelp } from './expression-codemirror';
import {
  expressionTokens,
  expressionDiagnostics,
  statementStart,
} from '../../src/expression-language';
function declaredNames(text: string): string[] {
  return Array.from(
    text.matchAll(
      /(?:^|[;\n])\s*((?:[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё0-9]*(?:\.[A-Za-zА-Яа-яЁё0-9]+)+)|(?:[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё_0-9]*))\s*[+*/-]?=/g,
    ),
    (match) => match[1].replace(/\./g, '_'),
  );
}
function assignmentTarget(left: string): string | undefined {
  return left
    .match(/^\s*([A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё_0-9.]*)\s*[+*/-]?=/)?.[1]
    ?.replace(/\./g, '_');
}
export function completions(
  context: CompletionContext,
  parameters: Parameter[],
  batch: boolean,
  currentTarget?: string,
) {
  if (inString(context.state.sliceDoc(0, context.pos))) return null;
  const word = context.matchBefore(/[A-Za-zА-Яа-яЁё_0-9]*/);
  if (!word) return null;
  const text = context.state.doc.toString();
  const path = text
    .slice(0, word.from)
    .match(
      /(?:^|[^A-Za-zА-Яа-яЁё_0-9.])([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё0-9]*\.(?:[A-Za-zА-Яа-яЁё0-9]+\.)*)$/,
    )?.[1];
  if (word.from === word.to && !context.explicit && !path) return null;
  if (!path && /^\d/.test(word.text)) return null;
  const showModelDimensions = !path && /^d$/i.test(word.text);
  const left = text.slice(statementStart(text, context.pos), context.pos);
  const nameContext = batch && !left.includes('=');
  const target =
    batch && !nameContext ? assignmentTarget(left) : !batch ? currentTarget : undefined;
  const earlierNames = batch ? declaredNames(text.slice(0, context.pos - left.length)) : [];
  const targetExists =
    target &&
    (parameters.some((parameter) => parameter.name.toLowerCase() === target.toLowerCase()) ||
      earlierNames.some((name) => name.toLowerCase() === target.toLowerCase()));
  const localNames = batch
    ? declaredNames(text).filter(
        (name) => targetExists || !target || name.toLowerCase() !== target.toLowerCase(),
      )
    : [];
  const seen = new Set(parameters.map((p) => p.name.toLowerCase()));
  const allNames = [...parameters.map((p) => p.name), ...localNames].filter(
    (name) => showModelDimensions || !/^d\d+$/i.test(name),
  );
  const hierarchy = allNames.filter((name) =>
    /^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё0-9]*(?:_[A-Za-zА-Яа-яЁё0-9]+)+$/.test(name),
  );
  const prefix = path ? path.slice(0, -1).split('.') : [];
  const objects = new Map<string, string>();
  const leaves = new Map<string, string>();
  for (const name of hierarchy) {
    const parts = name.split('_');
    if (
      !prefix.every((part, i) => parts[i]?.toLowerCase() === part.toLowerCase()) ||
      parts.length <= prefix.length
    )
      continue;
    const child = parts[prefix.length];
    const canonical = parts.slice(0, prefix.length + 1).join('.');
    if (parts.length > prefix.length + 1) objects.set(child, canonical);
    else leaves.set(child, canonical);
  }
  function applyPath(canonical: string, object = false): Completion['apply'] {
    return (view, completion, from, to) => {
      const start = from - (path?.length ?? 0);
      const existingDot = object && view.state.sliceDoc(to, to + 1) === '.';
      const insert = canonical + (object && !existingDot ? '.' : '');
      view.dispatch({
        changes: { from: start, to, insert },
        selection: { anchor: start + insert.length + (existingDot ? 1 : 0) },
        annotations: pickedCompletion.of(completion),
      });
    };
  }
  const objectOptions: Completion[] = Array.from(objects, ([label, canonical]) => ({
    label,
    type: 'namespace',
    detail: 'Object',
    boost: 99,
    apply: applyPath(canonical, true),
  }));
  if (path) {
    const leafOptions: Completion[] = Array.from(leaves, ([label, canonical]) => {
      const name = canonical.replace(/\./g, '_');
      const p = parameters.find((item) => item.name === name);
      return {
        label,
        type: 'variable',
        apply: applyPath(canonical),
        detail: p ? `${p.value} ${p.unit}`.trim() : 'In this batch',
        info: p ? [p.expression, p.comment].filter(Boolean).join(' · ') : undefined,
      };
    });
    return { from: word.from, options: [...objectOptions, ...leafOptions] };
  }
  const options: Completion[] = parameters
    .filter((p) => showModelDimensions || !/^d\d+$/i.test(p.name))
    .map((p) => ({
      label: p.name,
      type: 'variable',
      detail: `${p.value} ${p.unit}`.trim(),
      info: [p.expression, p.comment].filter(Boolean).join(' · '),
    }));
  for (const name of localNames)
    if (!seen.has(name.toLowerCase()) && (showModelDimensions || !/^d\d+$/i.test(name)))
      options.push({ label: name, type: 'variable', detail: 'In this batch' });
  if (nameContext) return { from: word.from, options: [...objectOptions, ...options] };
  if (targetExists) options.push({ label: 'this', type: 'variable', detail: 'Current value' });
  options.push(
    ...builtinCompletions().filter((item) => !parameters.some((p) => p.name === item.label)),
  );
  return { from: word.from, options: [...objectOptions, ...options] };
}
interface Props {
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onSubmit?: () => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  inline?: boolean;
  singleLine?: boolean;
  currentTarget?: string;
  parameters: Parameter[];
  batch?: boolean;
  disabled?: boolean;
  label: string;
  hint: string;
}
function highlighting(
  parameters: () => Parameter[],
  batch: () => boolean,
  currentTarget: () => string | undefined,
) {
  function decorate(view: EditorView): DecorationSet {
    const ranges: Range<Decoration>[] = [];
    const text = view.state.doc.toString();
    const declared = new Set(declaredNames(text));
    const known = new Set(parameters().map((p) => p.name));
    const diagnostics = expressionDiagnostics(
      text,
      new Map(parameters().map((p) => [p.name, p.unit])),
      batch(),
    );
    for (const token of expressionTokens(text)) {
      const value = token.value,
        from = token.from,
        rest = text.slice(token.to);
      let kind = 'operator';
      if (value.startsWith("'") || value.startsWith('"')) kind = 'string';
      else if (/^\d|^\./.test(value)) kind = 'number';
      else if (/^[A-Za-zА-Яа-яЁё_]/.test(value)) {
        const left = text.slice(statementStart(text, from), from);
        const current = batch() ? assignmentTarget(left) : currentTarget();
        if (known.has(value.replace(/\./g, '_'))) kind = 'parameter';
        else if (functionByName.has(value) && /^\s*\(/.test(rest)) kind = 'function';
        else if (constantByName.has(value)) kind = 'constant';
        else if (fusionOperators.includes(value)) kind = 'operator';
        else if (fusionUnits.includes(value)) kind = 'unit';
        else if (
          value === 'this' &&
          current &&
          (known.has(current) || declaredNames(text.slice(0, from - left.length)).includes(current))
        )
          kind = 'parameter';
        else if (declared.has(value.replace(/\./g, '_')) || (batch() && /^\s*=/.test(rest)))
          kind = 'new';
        else kind = 'unknown';
      }
      const diagnostic = diagnostics.find((d) => d.from === from && d.severity !== 'info');
      ranges.push(
        Decoration.mark({
          class: `token-${kind}${diagnostic ? ' token-error' : ''}`,
          attributes: diagnostic
            ? { title: diagnostic.message, 'aria-label': diagnostic.message }
            : {},
        }).range(from, from + value.length),
      );
    }
    return Decoration.set(ranges);
  }
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = decorate(view);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.transactions.length)
          this.decorations = decorate(update.view);
      }
    },
    { decorations: (v) => v.decorations },
  );
}
export function ExpressionEditor(props: Props) {
  const node = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>();
  const readOnly = useRef(new Compartment());
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    if (!node.current) return;
    const editor = new EditorView({
      parent: node.current,
      state: EditorState.create({
        doc: latest.current.value,
        extensions: [
          ...(props.singleLine
            ? [
                EditorState.transactionFilter.of((transaction) =>
                  transaction.newDoc.lines > 1 ? [] : transaction,
                ),
              ]
            : []),
          history(),
          expressionSignatureHelp,
          highlighting(
            () => latest.current.parameters,
            () => !!latest.current.batch,
            () => latest.current.currentTarget,
          ),
          placeholder(props.hint),
          EditorView.lineWrapping,
          EditorView.domEventObservers({
            focus: () => latest.current.onFocus?.(),
          }),
          readOnly.current.of([
            EditorState.readOnly.of(!!props.disabled),
            EditorView.editable.of(!props.disabled),
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              latest.current.onChange(update.state.doc.toString());
              const pos = update.state.selection.main.head;
              if (
                /(?:^|[^A-Za-zА-Яа-яЁё_0-9.])[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё0-9]*\.(?:[A-Za-zА-Яа-яЁё0-9]+\.)*$/.test(
                  update.state.sliceDoc(0, pos),
                )
              )
                setTimeout(() => startCompletion(update.view), 0);
            }
          }),
          autocompletion({
            override: [
              (ctx) =>
                completions(
                  ctx,
                  latest.current.parameters,
                  !!latest.current.batch,
                  latest.current.currentTarget,
                ),
            ],
          }),
          hoverTooltip((editor, pos) => {
            const line = editor.state.doc.lineAt(pos);
            const re = /[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё_0-9]*(?:\.[A-Za-zА-Яа-яЁё0-9]+)*/g;
            let match: RegExpExecArray | null;
            while ((match = re.exec(line.text))) {
              const from = line.from + match.index,
                to = from + match[0].length;
              if (pos >= from && pos <= to) {
                const p = latest.current.parameters.find(
                  (p) => p.name === match![0].replace(/\./g, '_'),
                );
                if (!p) return null;
                return {
                  pos: from,
                  end: to,
                  create: () => {
                    const dom = document.createElement('div');
                    dom.className = 'parameter-tooltip';
                    dom.textContent = `${p.name}: ${p.value} ${p.unit} · ${p.expression}${p.comment ? ` · ${p.comment}` : ''}`;
                    return { dom };
                  },
                };
              }
            }
            return null;
          }),
          keymap.of([
            { key: 'Tab', run: acceptCompletion },
            {
              key: 'Escape',
              run: (v) => {
                if (completionStatus(v.state)) return closeCompletion(v);
                if (!latest.current.onCancel) return false;
                latest.current.onCancel();
                return true;
              },
            },
            {
              key: 'Enter',
              run: (v) => {
                if (latest.current.disabled) return true;
                if (completionStatus(v.state)) return acceptCompletion(v) || true;
                if (latest.current.onSubmit) {
                  latest.current.onSubmit();
                  return true;
                }
                return false;
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.contentAttributes.of({ 'aria-label': props.label, role: 'textbox' }),
        ],
      }),
    });
    view.current = editor;
    if (latest.current.autoFocus) {
      editor.dispatch({ selection: { anchor: 0, head: editor.state.doc.length } });
      editor.focus();
    }
    return () => {
      editor.destroy();
      view.current = undefined;
    };
  }, []);
  useEffect(() => {
    view.current?.dispatch({
      effects: readOnly.current.reconfigure([
        EditorState.readOnly.of(!!props.disabled),
        EditorView.editable.of(!props.disabled),
      ]),
    });
  }, [props.disabled]);
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    if (completionStatus(editor.state)) {
      closeCompletion(editor);
      startCompletion(editor);
    }
    editor.dispatch({});
  }, [props.parameters]);
  useLayoutEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== props.value)
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: props.value } });
  }, [props.value]);
  return (
    <div
      class={`expression-editor ${props.inline ? 'parameter-edit' : ''} ${props.disabled ? 'disabled' : ''}`}
      ref={node}
      aria-disabled={props.disabled}
    />
  );
}
