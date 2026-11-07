import { render, type ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Calculator, Copy, History, ListTree, RefreshCw, X } from 'lucide-preact';
import { ParameterList, expressionWithoutUnit } from './parameter-list';
import { ExpressionEditor } from './editor';
import { prepareInlineEdit } from './inline-edit';
import {
  onStateChanged,
  onParametersPrefill,
  request,
  type Calculation,
  type CleanupItem,
  type ModelState,
  type Preview,
  type Prefill,
  type Parameter,
} from './bridge';
import './style.css';
import { canApplyPreview } from './guards';
const CLEANUP_ENABLED: boolean = false;
function Section({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <section aria-label={title}>
      <div class="section-body">{children}</div>
    </section>
  );
}
function message(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
export function App() {
  const [model, setModel] = useState<ModelState | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [problem, setProblem] = useState(''),
    [notice, setNotice] = useState('');
  const [text, setText] = useState(''),
    [preview, setPreview] = useState<Preview | null>(null),
    [previewError, setPreviewError] = useState(''),
    [previewText, setPreviewText] = useState(''),
    [previewDoc, setPreviewDoc] = useState(''),
    [previewRevision, setPreviewRevision] = useState(0);
  const [view, setView] = useState<'editor' | 'list'>('editor');
  const [editing, setEditing] = useState<Parameter | null>(null);
  const [editText, setEditText] = useState('');
  const [editError, setEditError] = useState('');
  const editGeneration = useRef(0);
  const expression = text;
  const assignment = text.includes('=');
  const [result, setResult] = useState<Calculation | null>(null),
    [calcError, setCalcError] = useState('');
  const [history, setHistory] = useState<string[]>([]),
    [showHistory, setShowHistory] = useState(false);
  const mode = CLEANUP_ENABLED && window.location.hash === '#cleanup' ? 'cleanup' : 'parameters';
  const [cleanup, setCleanup] = useState<CleanupItem[] | null>(null),
    [filter, setFilter] = useState(''),
    [confirm, setConfirm] = useState(false),
    [incomingPrefill, setIncomingPrefill] = useState<Prefill | null>(null),
    [confirmPrefill, setConfirmPrefill] = useState<Prefill | null>(null);
  const generation = useRef(0),
    focusGeneration = useRef(0),
    previewGen = useRef(0),
    calcGen = useRef(0),
    doc = useRef<string | null>(null),
    lastDocument = useRef<string | null>(null),
    busyRef = useRef(false),
    textRef = useRef(text),
    historyRef = useRef(history),
    drafts = useRef(new Map<string, { text: string; history: string[] }>()),
    refreshFlight = useRef<Promise<void> | null>(null),
    seenPrefills = useRef(new Set<string>());
  const modelRef = useRef(model);
  modelRef.current = model;
  textRef.current = text;
  historyRef.current = history;
  const available = !!model?.documentId && !loading;
  async function refreshNow() {
    const gen = ++generation.current;
    ++focusGeneration.current;
    ++previewGen.current;
    ++calcGen.current;
    doc.current = null;
    setLoading(true);
    setModel(null);
    ++editGeneration.current;
    setEditing(null);
    setPreview(null);
    setResult(null);
    setCleanup(null);
    setConfirm(false);
    setConfirmPrefill(null);
    try {
      const next = await request<ModelState>('state.get');
      if (gen !== generation.current) return;
      const draftId = next.draftId || next.documentId;
      if (lastDocument.current !== draftId) {
        setProblem('');
        if (lastDocument.current) {
          drafts.current.set(lastDocument.current, {
            text: textRef.current,
            history: historyRef.current,
          });
        }
        const saved = draftId ? drafts.current.get(draftId) : undefined;
        setText(saved?.text || '');
        setHistory(saved?.history || []);
        setConfirmPrefill(null);
      }
      lastDocument.current = draftId;
      doc.current = next.documentId;
      setModel(next);
    } catch (e) {
      if (gen === generation.current) setProblem(message(e));
    } finally {
      if (gen === generation.current) setLoading(false);
    }
  }
  function refresh() {
    const operation = refreshNow();
    refreshFlight.current = operation;
    void operation.finally(() => {
      if (refreshFlight.current === operation) refreshFlight.current = null;
    });
    return operation;
  }
  async function refreshOnFocus(allowBusy = false) {
    const id = doc.current;
    if (!id || (!allowBusy && busyRef.current) || refreshFlight.current) return;
    const gen = generation.current;
    const focusGen = ++focusGeneration.current;
    try {
      const next = await request<ModelState>('state.get');
      if (gen !== generation.current || focusGen !== focusGeneration.current || doc.current !== id)
        return;
      const current = modelRef.current;
      if (
        !current ||
        next.documentId !== id ||
        (next.draftId || next.documentId) !== (current.draftId || current.documentId)
      ) {
        await refresh();
        return;
      }
      if (JSON.stringify(current) !== JSON.stringify(next)) {
        ++previewGen.current;
        ++calcGen.current;
        setPreview(null);
        setResult(null);
        setCleanup(null);
        ++editGeneration.current;
        setEditing(null);
        setModel(next);
      }
    } catch {
      if (gen === generation.current && focusGen === focusGeneration.current && doc.current === id)
        await refresh();
    }
  }
  useEffect(
    () =>
      onParametersPrefill((incoming) => {
        if (mode === 'parameters') setIncomingPrefill(incoming);
      }),
    [mode],
  );
  useEffect(() => {
    if (!incomingPrefill || loading || !model?.documentId) return;
    setIncomingPrefill(null);
    if (incomingPrefill.documentId !== model.documentId || doc.current !== model.documentId) return;
    void request(
      'parameters.prefill.ack',
      { prefillId: incomingPrefill.prefillId },
      model.documentId,
    ).catch(() => {});
    if (seenPrefills.current.has(incomingPrefill.prefillId)) return;
    seenPrefills.current.add(incomingPrefill.prefillId);
    if (textRef.current.trim()) setConfirmPrefill(incomingPrefill);
    else setText(incomingPrefill.text);
  }, [incomingPrefill, loading, model]);
  useEffect(() => {
    void refresh();
    return onStateChanged(() => {
      if (!doc.current || refreshFlight.current) void refresh();
      else void refreshOnFocus(true);
    });
  }, []);
  useEffect(() => {
    const gen = ++previewGen.current;
    setPreview(null);
    setPreviewError('');
    if (!available || !text.trim() || !assignment || !model?.documentId) return;
    const id = model.documentId;
    const timer = window.setTimeout(() => {
      void request<Preview>('parameters.preview', { text }, id)
        .then((data) => {
          if (gen === previewGen.current && doc.current === id) {
            setPreviewText(text);
            setPreviewDoc(id);
            setPreview(data);
          }
        })
        .catch((e) => {
          if (gen === previewGen.current && doc.current === id) setPreviewError(message(e));
        });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [text, model, loading, previewRevision]);
  useEffect(() => {
    const gen = ++calcGen.current;
    setResult(null);
    setCalcError('');
    if (!available || !expression.trim() || assignment || !model?.documentId) return;
    const id = model.documentId;
    const timer = window.setTimeout(() => {
      void request<Calculation>('calculator.evaluate', { expression }, id)
        .then((data) => {
          if (gen === calcGen.current && doc.current === id) {
            setResult(data);
            setHistory((h) => [expression, ...h.filter((x) => x !== expression)].slice(0, 20));
          }
        })
        .catch((e) => {
          if (gen === calcGen.current && doc.current === id) setCalcError(message(e));
        });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [expression, model, loading]);
  async function apply() {
    const id = doc.current,
      submitted = textRef.current;
    if (
      !id ||
      !canApplyPreview(
        preview
          ? {
              valid: preview.valid,
              text: previewText,
              documentId: previewDoc,
              snapshotToken: preview.snapshotToken,
            }
          : null,
        submitted,
        id,
      ) ||
      busyRef.current ||
      loading
    )
      return;
    busyRef.current = true;
    setBusy(true);
    setProblem('');
    try {
      await request(
        'parameters.apply',
        { text: submitted, snapshotToken: preview!.snapshotToken },
        id,
      );
      if (refreshFlight.current) await refreshFlight.current;
      if (doc.current !== id) return;
      if (textRef.current === submitted) setText('');
      await refreshOnFocus(true);
    } catch (e) {
      if (refreshFlight.current) await refreshFlight.current;
      if (doc.current === id) {
        setPreview(null);
        setProblem(`${message(e)} Review the refreshed preview before trying again.`);
        setPreviewRevision((x) => x + 1);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function applyEdit() {
    const id = doc.current;
    if (!id || !editing || busyRef.current) return;
    const expression = editText.trim();
    let prepared: ReturnType<typeof prepareInlineEdit>;
    try {
      prepared = prepareInlineEdit(editing, expression, modelRef.current?.parameters || []);
    } catch (e) {
      setEditError(message(e));
      return;
    }
    if (!prepared.newName && expression === expressionWithoutUnit(editing).trim()) {
      setEditing(null);
      return;
    }
    const submitted = prepared.text;
    const gen = ++editGeneration.current;
    busyRef.current = true;
    setBusy(true);
    setEditError('');
    try {
      const preview = await request<Preview>(
        'parameters.preview',
        {
          text: submitted,
          ...(prepared.equation
            ? { inlineEquation: { target: editing.name, expression: prepared.equation } }
            : {}),
          ...(prepared.sourceValueExpression
            ? { sourceName: editing.name, sourceValueExpression: prepared.sourceValueExpression }
            : {}),
        },
        id,
      );
      if (gen !== editGeneration.current || doc.current !== id) return;
      const newName = prepared.equation ? preview.newName : prepared.newName;
      const resolvedText = prepared.equation ? preview.resolvedText : submitted;
      if (
        !preview.valid ||
        !preview.snapshotToken ||
        !resolvedText ||
        (prepared.equation && !newName) ||
        preview.items.length !== (newName ? 2 : 1) ||
        !preview.items.some((item) => item.name === editing.name && item.status === 'Update') ||
        (!!newName && !preview.items.some((item) => item.name === newName && item.status === 'New'))
      ) {
        setEditError(preview.items[0]?.message || 'Cannot apply this expression.');
        return;
      }
      await request(
        'parameters.apply',
        {
          text: resolvedText,
          snapshotToken: preview.snapshotToken,
          ...(newName ? { requireTransaction: true } : {}),
        },
        id,
      );
      if (refreshFlight.current) await refreshFlight.current;
      if (doc.current === id) {
        setEditing(null);
        await refreshOnFocus(true);
      }
    } catch (e) {
      if (gen === editGeneration.current && doc.current === id) setEditError(message(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function deleteParameter(parameter: Parameter) {
    const id = doc.current;
    if (!id || busyRef.current) return;
    if (!parameter.entityToken) {
      setProblem('Parameter identity is unavailable. Refresh and try again.');
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setProblem('');
    try {
      await request(
        'parameters.delete',
        { name: parameter.name, entityToken: parameter.entityToken },
        id,
      );
      if (refreshFlight.current) await refreshFlight.current;
      if (doc.current === id) {
        setNotice(`Deleted ${parameter.name}.`);
        await refreshOnFocus(true);
      }
    } catch (e) {
      if (refreshFlight.current) await refreshFlight.current;
      if (doc.current === id) setProblem(message(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function renameParameter(parameter: Parameter, newName: string): Promise<boolean> {
    const id = doc.current;
    if (!id || busyRef.current || !parameter.entityToken) return false;
    if (newName === parameter.name) return true;
    busyRef.current = true;
    setBusy(true);
    setProblem('');
    try {
      await request(
        'parameters.rename',
        {
          name: parameter.name,
          newName,
          entityToken: parameter.entityToken,
          expression: parameter.expression,
          unit: parameter.unit,
        },
        id,
      );
      if (refreshFlight.current) await refreshFlight.current;
      if (doc.current === id) await refreshOnFocus(true);
      return true;
    } catch (e) {
      if (doc.current === id) setProblem(message(e));
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function toggleFavorite(parameter: Parameter) {
    const id = doc.current;
    if (!id || busyRef.current || !parameter.entityToken || typeof parameter.favorite !== 'boolean')
      return;
    busyRef.current = true;
    setBusy(true);
    setProblem('');
    try {
      await request(
        'parameters.favorite',
        {
          name: parameter.name,
          entityToken: parameter.entityToken,
          expected: parameter.favorite,
          favorite: !parameter.favorite,
        },
        id,
      );
      if (refreshFlight.current) await refreshFlight.current;
      if (doc.current === id) await refreshOnFocus(true);
    } catch (e) {
      if (doc.current === id) {
        setProblem(message(e));
        await refreshOnFocus(true);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice('Copied to clipboard.');
      if (expression.trim())
        setHistory((h) => [expression, ...h.filter((x) => x !== expression)].slice(0, 20));
    } catch {
      setProblem('Clipboard is unavailable in this environment.');
    }
  }
  async function analyze() {
    const id = doc.current;
    if (!id || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setProblem('');
    try {
      const data = await request<{ items: CleanupItem[] }>('cleanup.analyze', {}, id);
      if (doc.current === id) setCleanup(data.items);
    } catch (e) {
      if (doc.current === id) setProblem(message(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function removeSelected() {
    const id = doc.current;
    if (!id || !cleanup || busyRef.current) return;
    const names = cleanup
      .filter((x) => x.selected && !x.protected && !x.favorite)
      .map((x) => x.name);
    if (!names.length) return;
    busyRef.current = true;
    setBusy(true);
    setConfirm(false);
    try {
      await request('cleanup.delete', { names }, id);
      if (refreshFlight.current) await refreshFlight.current;
      if (doc.current === id) {
        setNotice('Selected parameters deleted.');
        await refresh();
      }
    } catch (e) {
      if (doc.current === id) setProblem(message(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  const selected = cleanup?.filter((x) => x.selected && !x.protected && !x.favorite).length ?? 0;
  return (
    <main>
      <div class="context">
        <span class={`dot ${available ? 'online' : ''}`} />
        <span>
          {loading
            ? 'Connecting to Fusion…'
            : model?.documentId
              ? model.documentName || 'Active design'
              : 'No active design'}
        </span>
        {mode === 'parameters' && (
          <div class="view-tabs" role="tablist" aria-label="Palette views">
            <button
              class={`icon ${view === 'editor' ? 'active' : ''}`}
              role="tab"
              aria-selected={view === 'editor'}
              aria-label="Calculator"
              title="Calculator"
              onClick={() => setView('editor')}
            >
              <Calculator size={15} />
            </button>
            <button
              class={`icon ${view === 'list' ? 'active' : ''}`}
              role="tab"
              aria-selected={view === 'list'}
              aria-label="Parameter list"
              title="Parameter list"
              onClick={() => setView('list')}
            >
              <ListTree size={15} />
            </button>
          </div>
        )}
        <span class="unit">{model?.defaultLengthUnit || ''}</span>
        <button
          class="icon refresh"
          title="Refresh model"
          aria-label="Refresh model"
          onClick={() => void refresh()}
        >
          <RefreshCw size={14} />
        </button>
      </div>
      {problem && (
        <div class="alert" role="alert">
          {problem}
          <button class="icon" aria-label="Dismiss" onClick={() => setProblem('')}>
            <X size={13} />
          </button>
        </div>
      )}
      {notice && (
        <div class="notice" role="status">
          {notice}
          <button class="icon" aria-label="Dismiss" onClick={() => setNotice('')}>
            <X size={13} />
          </button>
        </div>
      )}
      {mode === 'parameters' && (
        <div class={`palette-layout view-${view}`}>
          <div class="editor-pane">
            {mode === 'parameters' && (
              <Section title="Paramood">
                <p class="helper">Calculate an expression or assign it to a parameter</p>
                <ExpressionEditor
                  value={text}
                  onChange={setText}
                  onFocus={() => void refreshOnFocus()}
                  onSubmit={assignment ? () => void apply() : undefined}
                  parameters={model?.parameters || []}
                  batch={assignment}
                  disabled={!available || busy}
                  label="Parameter definitions"
                  hint="2+3  or  width=15; height=width/2"
                />
                <div class="hint">
                  {assignment
                    ? 'Separate definitions with semicolons'
                    : 'Use model parameters in expressions'}{' '}
                  <span>{assignment ? 'Enter to apply' : ''}</span>
                </div>
                {assignment && previewError && (
                  <div class="error" role="alert">
                    {previewError}
                  </div>
                )}
                {assignment && preview && (
                  <div class="preview">
                    <div class="minor-label">Preview</div>
                    {preview.items.map((item) => (
                      <div class="preview-row" key={item.name}>
                        <div>
                          <strong>{item.name}</strong>
                          <span class="formula">{item.expression}</span>
                          {item.message && <span class="error">{item.message}</span>}
                        </div>
                        <div class="row-end">
                          <span>
                            {item.previous ? `${item.previous} → ` : ''}
                            {item.value ?? ''} {item.unit ?? ''}
                          </span>
                          <span class={`badge ${item.status.toLowerCase()}`}>{item.status}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div class="actions parameter-actions">
                  {CLEANUP_ENABLED && (
                    <button
                      disabled={!available || busy}
                      onClick={() => {
                        const id = doc.current;
                        if (id)
                          void request('cleanup.open', {}, id).catch((e) => setProblem(message(e)));
                      }}
                    >
                      Clean unused…
                    </button>
                  )}
                  <button
                    class="icon"
                    aria-label="Calculation history"
                    title="Calculation history"
                    disabled={assignment}
                    onClick={() => setShowHistory(!showHistory)}
                  >
                    <History size={15} />
                  </button>
                  {assignment && (
                    <button
                      class="primary"
                      disabled={
                        !available ||
                        busy ||
                        !canApplyPreview(
                          preview
                            ? {
                                valid: preview.valid,
                                text: previewText,
                                documentId: previewDoc,
                                snapshotToken: preview.snapshotToken,
                              }
                            : null,
                          text,
                          model?.documentId ?? null,
                        )
                      }
                      onClick={() => void apply()}
                    >
                      Apply parameters <kbd>Enter</kbd>
                    </button>
                  )}
                </div>
                {showHistory && !assignment && (
                  <div class="history">
                    {history.length ? (
                      history.map((item) => (
                        <button
                          onClick={() => {
                            setText(item);
                            setShowHistory(false);
                          }}
                        >
                          {item}
                        </button>
                      ))
                    ) : (
                      <span>No calculations yet.</span>
                    )}
                  </div>
                )}
              </Section>
            )}
            {mode === 'parameters' && !assignment && !!text.trim() && (
              <Section title="Result">
                {calcError && (
                  <div class="error" role="alert">
                    {calcError}
                  </div>
                )}
                <div class="result">
                  <div>
                    <span class="minor-label">Result</span>
                    <div class="result-value">{result?.formatted ?? '—'}</div>
                  </div>
                  <button
                    class="icon"
                    title="Copy value and unit"
                    aria-label="Copy value and unit"
                    disabled={!result}
                    onClick={() => result && void copy(result.formatted)}
                  >
                    <Copy size={15} />
                  </button>
                </div>
                <div class="actions secondary-actions">
                  <button
                    disabled={!result}
                    onClick={() => result && void copy(String(result.value))}
                  >
                    Copy number
                  </button>
                  <button disabled={!expression} onClick={() => void copy(expression)}>
                    Copy expression
                  </button>
                </div>
              </Section>
            )}
          </div>
          <div class="list-pane">
            <ParameterList
              parameters={model?.parameters || []}
              onDelete={(parameter) => void deleteParameter(parameter)}
              onRename={renameParameter}
              onFavorite={(parameter) => void toggleFavorite(parameter)}
              busy={busy}
              editingName={editing?.name}
              editor={
                editing && (
                  <ExpressionEditor
                    inline
                    autoFocus
                    label={`Expression for ${editing.name}`}
                    hint="Expression"
                    parameters={model?.parameters || []}
                    currentTarget={editing.name}
                    batch={editText.includes('=')}
                    value={editText}
                    disabled={busy}
                    onChange={(value) => {
                      ++editGeneration.current;
                      setEditText(value);
                      setEditError('');
                    }}
                    onSubmit={() => void applyEdit()}
                    onCancel={() => {
                      ++editGeneration.current;
                      setEditing(null);
                      setEditError('');
                    }}
                  />
                )
              }
              onEdit={(parameter) => {
                if (busyRef.current) return;
                ++editGeneration.current;
                setEditing(parameter);
                setEditText(expressionWithoutUnit(parameter));
                setEditError('');
              }}
            />
          </div>
        </div>
      )}
      {editError && (
        <div class="alert" role="alert">
          {editError}
          <button class="icon" aria-label="Dismiss edit error" onClick={() => setEditError('')}>
            <X size={13} />
          </button>
        </div>
      )}
      {mode === 'cleanup' && (
        <div id="cleanup-section">
          <Section title="Paramood-Cleanup">
            <p class="helper">Analyze current parameters. Deletion is not available yet.</p>
            <button disabled={!available || busy} onClick={() => void analyze()}>
              Analyze parameters
            </button>
            {cleanup && (
              <div class="cleanup">
                <input
                  aria-label="Search parameters"
                  placeholder="Search parameters"
                  value={filter}
                  onInput={(e) => setFilter(e.currentTarget.value)}
                />
                <div class="cleanup-actions">
                  <button
                    onClick={() =>
                      setCleanup(
                        cleanup.map((x) => ({ ...x, selected: !x.protected && !x.favorite })),
                      )
                    }
                  >
                    Select all
                  </button>
                  <button
                    onClick={() => setCleanup(cleanup.map((x) => ({ ...x, selected: false })))}
                  >
                    Deselect all
                  </button>
                  <span>{selected} selected</span>
                </div>
                {cleanup
                  .filter((x) => x.name.toLowerCase().includes(filter.toLowerCase()))
                  .map((item) => (
                    <label class="cleanup-row">
                      <input
                        type="checkbox"
                        checked={item.selected && !item.protected && !item.favorite}
                        disabled={item.protected || item.favorite}
                        onChange={(e) =>
                          setCleanup(
                            cleanup.map((x) =>
                              x.name === item.name
                                ? { ...x, selected: e.currentTarget.checked }
                                : x,
                            ),
                          )
                        }
                      />
                      <span>
                        <strong>{item.name}</strong>
                        <small>
                          {item.expression} · {item.value} {item.unit}
                        </small>
                        <small>
                          {item.favorite ? 'Favorite · ' : ''}
                          {item.reason}
                        </small>
                      </span>
                    </label>
                  ))}
                {!cleanup.length && <p class="helper">No candidates found.</p>}
                <button
                  class="danger"
                  disabled={!selected || busy}
                  onClick={() => setConfirm(true)}
                >
                  Delete selected…
                </button>
              </div>
            )}
          </Section>
        </div>
      )}
      {confirmPrefill && (
        <div class="overlay">
          <div role="dialog" aria-modal="true" aria-labelledby="replace-title" class="dialog">
            <h2 id="replace-title">Replace your current input?</h2>
            <p>
              Paramood already contains text. Replace it with the expression from Paramood-Calc?
            </p>
            <div class="actions">
              <button onClick={() => setConfirmPrefill(null)}>Keep current input</button>
              <button
                class="primary"
                onClick={() => {
                  if (doc.current === confirmPrefill.documentId) setText(confirmPrefill.text);
                  setConfirmPrefill(null);
                }}
              >
                Replace input
              </button>
            </div>
          </div>
        </div>
      )}
      {confirm && (
        <div class="overlay">
          <div role="dialog" aria-modal="true" aria-labelledby="confirm-title" class="dialog">
            <h2 id="confirm-title">Delete {selected} parameters?</h2>
            <p>Dependencies will be checked again before deletion.</p>
            <div class="actions">
              <button onClick={() => setConfirm(false)}>Cancel</button>
              <button class="danger" disabled={busy} onClick={() => void removeSelected()}>
                Delete parameters
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
const appRoot = document.getElementById('app');
if (appRoot) render(<App />, appRoot);
