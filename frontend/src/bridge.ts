export interface Parameter {
  name: string;
  expression: string;
  value: string | number;
  valueType?: 'text' | 'number';
  unit: string;
  comment?: string;
  kind?: 'user' | 'model';
  linked?: boolean;
  bindings?: ('sketch' | 'feature' | 'other' | 'unknown')[];
  entityToken?: string;
  driven?: boolean;
  favorite?: boolean;
  valueExpression?: string | null;
  configured?: boolean;
  unused?: boolean;
}
export interface ModelState {
  draftId?: string;
  documentId: string | null;
  documentName?: string;
  defaultLengthUnit?: string;
  unitsSnapshotToken?: string;
  parameters: Parameter[];
  variants?: Variant[];
  activeVariantId?: string | null;
  variantsToken?: string;
  variantSnapshotToken?: string;
  variantsError?: string;
  variantColumns?: VariantColumn[];
  variantTableVersion?: number;
  timelineFeatures?: VariantFeature[];
}
export interface VariantParameter {
  name: string;
  entityToken: string;
  expression: string;
  unit: string;
  value: number | string;
  missing?: boolean;
}
export interface Variant {
  id: string;
  name: string;
  parameters: VariantParameter[];
  features?: VariantFeature[];
}
export interface VariantFeature {
  name: string;
  entityToken: string;
  enabled: boolean;
  missing?: boolean;
}
export interface VariantColumn {
  kind: 'parameter' | 'feature';
  name: string;
  entityToken: string;
  unit?: string;
  missing?: boolean;
}
export interface PreviewItem {
  name: string;
  expression: string;
  value?: string | number;
  unit?: string;
  status: 'New' | 'Update' | 'Error' | 'Warning';
  estimated?: boolean;
  previous?: string;
  message?: string;
}
export interface Preview {
  snapshotToken: string;
  items: PreviewItem[];
  valid: boolean;
  resolvedText?: string;
  newName?: string;
}
export interface Calculation {
  value: string | number;
  unit: string;
  formatted: string;
}
export interface CleanupItem extends Parameter {
  dependencies: string[];
  reason: string;
  selected: boolean;
  protected: boolean;
  favorite?: boolean;
}
export interface BridgeError {
  code: string;
  message: string;
}
interface Response {
  requestId: string;
  ok: boolean;
  data?: unknown;
  error?: BridgeError;
  documentId?: string | null;
}
type Pending = { resolve: (r: Response) => void; reject: (e: Error) => void; timer: number };
declare global {
  interface Window {
    adsk?: { fusionSendData: (action: string, data: string) => void };
    fusionJavaScriptHandler?: { handle: (action: string, data: string) => string };
  }
}
const pending = new Map<string, Pending>();
let sequence = 0;
const windowId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
let eventListener: (() => void) | undefined;
export interface Prefill {
  text: string;
  documentId: string;
  prefillId: string;
}
let prefillListener: ((payload: Prefill) => void) | undefined;
export interface TimelineSelection {
  documentId: string;
  features: VariantFeature[];
}
let timelineSelectionListener: ((payload: TimelineSelection) => void) | undefined;
window.fusionJavaScriptHandler = {
  handle(action, raw) {
    if (action === 'variants.selection') {
      try {
        const payload = JSON.parse(raw) as TimelineSelection;
        if (
          typeof payload.documentId !== 'string' ||
          !Array.isArray(payload.features) ||
          !payload.features.every(
            (f) =>
              typeof f.name === 'string' &&
              typeof f.entityToken === 'string' &&
              typeof f.enabled === 'boolean',
          )
        )
          return 'Invalid payload';
        timelineSelectionListener?.(payload);
        return 'OK';
      } catch {
        return 'Invalid payload';
      }
    }
    if (action === 'state.changed') {
      eventListener?.();
      return 'OK';
    }
    if (action === 'parameters.prefill') {
      try {
        const payload = JSON.parse(raw) as Prefill;
        if (
          typeof payload.text !== 'string' ||
          typeof payload.documentId !== 'string' ||
          !payload.documentId ||
          typeof payload.prefillId !== 'string' ||
          !payload.prefillId
        )
          return 'Invalid payload';
        if (!prefillListener) return 'Not ready';
        prefillListener(payload);
        return 'OK';
      } catch {
        return 'Invalid payload';
      }
    }
    if (action !== 'response') return 'Unsupported action';
    try {
      const response = JSON.parse(raw) as Response;
      const request = pending.get(response.requestId);
      if (request) {
        window.clearTimeout(request.timer);
        pending.delete(response.requestId);
        request.resolve(response);
      }
      return 'OK';
    } catch {
      return 'Invalid response';
    }
  },
};
export function onStateChanged(listener: () => void): () => void {
  eventListener = listener;
  return () => {
    if (eventListener === listener) eventListener = undefined;
  };
}
export function onTimelineSelection(listener: (payload: TimelineSelection) => void): () => void {
  timelineSelectionListener = listener;
  return () => {
    if (timelineSelectionListener === listener) timelineSelectionListener = undefined;
  };
}
export function onParametersPrefill(listener: (payload: Prefill) => void): () => void {
  prefillListener = listener;
  return () => {
    if (prefillListener === listener) prefillListener = undefined;
  };
}
/** Fusion may inject its bridge after the local HTML starts executing. */
function waitForFusionBridge(): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const check = () => {
      if (window.adsk?.fusionSendData) {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(
          new Error(
            'Could not connect to Autodesk Fusion. Reopen Paramood from Fusion and try again.',
          ),
        );
        return;
      }
      window.setTimeout(check, 50);
    };
    check();
  });
}
export async function request<T>(
  action: string,
  payload: Record<string, unknown> = {},
  documentId?: string,
): Promise<T> {
  if (!window.adsk?.fusionSendData) await waitForFusionBridge();
  const requestId = `pm-${windowId}-${++sequence}`;
  const result = await new Promise<Response>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('Fusion did not respond. Try again.'));
    }, 15000);
    pending.set(requestId, { resolve, reject, timer });
    try {
      window.adsk!.fusionSendData(
        'request',
        JSON.stringify({ requestId, action, payload, ...(documentId ? { documentId } : {}) }),
      );
    } catch (e) {
      window.clearTimeout(timer);
      pending.delete(requestId);
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
  if (documentId && result.documentId !== documentId)
    throw new Error('The active document changed. Refresh and try again.');
  if (!result.ok) throw new Error(result.error?.message || 'The operation failed.');
  return result.data as T;
}
