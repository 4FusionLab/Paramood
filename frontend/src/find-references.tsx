import { createPortal } from 'preact/compat';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Search, X, DraftingCompass, Shapes } from 'lucide-preact';
import { request, type Parameter } from './bridge';
import { Presence } from './presence';

type Use = {
  name: string;
  expression: string;
  entityToken: string;
  path: string[];
  relation: 'Owner' | 'Direct' | 'Indirect' | 'Unknown';
};
export type ReferenceResults = {
  features: {
    name: string;
    entityToken: string;
    component: string;
    kind: 'Sketch' | 'Feature';
    uses: Use[];
  }[];
  parameters: Use[];
  warnings: string[];
};

export function FindReferences({
  parameter,
  documentId,
  disabled,
}: {
  parameter: Parameter;
  documentId: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [openedFor, setOpenedFor] = useState('');
  const [trail, setTrail] = useState<Pick<Use, 'name' | 'entityToken' | 'expression'>[]>([]);
  const scope = JSON.stringify([
    documentId,
    parameter.name,
    parameter.entityToken,
    parameter.expression,
  ]);
  const [result, setResult] = useState<ReferenceResults | null>(null);
  const [error, setError] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const target = trail[trail.length - 1] ?? parameter;
  const name = target.name;
  const entityToken = target.entityToken;
  const close = () => {
    ++generation.current;
    setOpen(false);
    trigger.current?.focus();
  };
  useLayoutEffect(() => {
    ++generation.current;
    setOpen(false);
    setTrail([]);
    return () => {
      ++generation.current;
    };
  }, [scope]);
  useLayoutEffect(() => {
    if (!open || openedFor !== scope) return;
    const current = ++generation.current;
    setResult(null);
    setError('');
    setSelected('');
    setSelecting(false);
    void request<ReferenceResults>('parameters.references', { name, entityToken }, documentId)
      .then((value) => {
        if (generation.current === current) setResult(value);
      })
      .catch((e: unknown) => {
        if (generation.current === current) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      ++generation.current;
    };
  }, [open, openedFor, scope, documentId, name, entityToken]);
  useLayoutEffect(() => {
    if (open) dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [open]);
  const select = async (targetToken: string) => {
    if (selecting || disabled) return;
    const current = generation.current;
    setSelecting(true);
    setSelected('');
    setError('');
    try {
      await request('parameters.references.select', { name, entityToken, targetToken }, documentId);
      if (generation.current === current) setSelected(targetToken);
    } catch (e) {
      if (generation.current === current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (generation.current === current) setSelecting(false);
    }
  };
  return (
    <>
      <button
        ref={trigger}
        class="icon parameter-references"
        title="Find References"
        aria-label={`Find References ${parameter.name}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled || !entityToken}
        onClick={() => {
          setTrail([]);
          setOpenedFor(scope);
          setOpen(true);
        }}
      >
        <Search size={13} />
      </button>
      {createPortal(
        <Presence show={open && openedFor === scope}>
          <div
            class="overlay references-overlay"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) close();
            }}
          >
            <div
              class="dialog references-dialog"
              role="dialog"
              aria-modal="true"
              aria-label={`Find References: ${name}`}
              ref={dialog}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  close();
                }
                if (event.key === 'Tab') {
                  const buttons = Array.from(
                    dialog.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
                  );
                  const first = buttons[0],
                    last = buttons[buttons.length - 1];
                  if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last?.focus();
                  } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first?.focus();
                  }
                }
              }}
            >
              <div class="references-heading">
                <div>
                  <h2>Find References</h2>
                  <p>{name}</p>
                </div>
                <button class="icon" title="Close" aria-label="Close references" onClick={close}>
                  <X size={16} />
                </button>
              </div>
              {trail.length > 0 && (
                <nav class="reference-breadcrumbs" aria-label="Reference navigation">
                  <button onClick={() => setTrail([])}>{parameter.name}</button>
                  {trail.map((step, index) => (
                    <span key={`${index}-${step.entityToken}`}>
                      {' '}
                      →{' '}
                      {index === trail.length - 1 ? (
                        <span aria-current="page">{step.name}</span>
                      ) : (
                        <button onClick={() => setTrail(trail.slice(0, index + 1))}>
                          {step.name}
                        </button>
                      )}
                    </span>
                  ))}
                </nav>
              )}
              {error && (
                <p class="error" role="alert">
                  {error}
                </p>
              )}
              {!result && !error && <p role="status">Finding references…</p>}
              {result && (
                <>
                  {result.features.length > 0 && (
                    <p class="references-hint">Click a feature to select it in Fusion.</p>
                  )}
                  <div class="references-results" key={`${name}:${entityToken}`}>
                    {result.features.map((feature) => (
                      <button
                        type="button"
                        key={feature.entityToken}
                        class="reference-feature"
                        aria-pressed={selected === feature.entityToken}
                        disabled={selecting || disabled}
                        onClick={() => void select(feature.entityToken)}
                      >
                        <span class="reference-feature-title">
                          {feature.kind === 'Sketch' ? (
                            <DraftingCompass size={15} />
                          ) : (
                            <Shapes size={15} />
                          )}
                          <strong>{feature.name}</strong>
                          <span>{feature.component}</span>
                        </span>
                        {feature.uses.map((use) => (
                          <span class="reference-use" key={use.name}>
                            <span>
                              {use.name} = {use.expression}
                            </span>
                            <small>
                              {use.relation}
                              {use.path.length > 2 ? ` · ${use.path.join(' → ')}` : ''}
                            </small>
                          </span>
                        ))}
                      </button>
                    ))}
                    {result.parameters.length > 0 && (
                      <div class="reference-parameters">
                        <h3>Dependent parameters</h3>
                        {result.parameters.map((use) => (
                          <button
                            class="reference-use reference-parameter"
                            key={use.name}
                            disabled={selecting || disabled}
                            title={`Find References ${use.name}`}
                            onClick={() => {
                              ++generation.current;
                              setTrail([...trail, use]);
                            }}
                          >
                            <span>
                              {use.name} = {use.expression}
                            </span>
                            <small>
                              {use.relation}
                              {use.path.length > 2 ? ` · ${use.path.join(' → ')}` : ''}
                            </small>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {!result.features.length &&
                    !result.parameters.length &&
                    !result.warnings.length && <p>No parameter or timeline references found.</p>}
                  {result.warnings.map((warning) => (
                    <p class="warning" key={warning}>
                      {warning}
                    </p>
                  ))}
                  <p role="status" class="references-status">
                    {selecting ? 'Selecting…' : selected ? 'Selected in Fusion' : ''}
                  </p>
                </>
              )}
            </div>
          </div>
        </Presence>,
        document.body,
      )}
    </>
  );
}
