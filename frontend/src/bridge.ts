export interface Parameter {
  name: string;
  expression: string;
  value: string | number;
  unit: string;
  comment?: string;
}
export interface ModelState {
  draftId?: string;
  documentId: string | null;
  documentName?: string;
  defaultLengthUnit?: string;
  parameters: Parameter[];
}
export interface PreviewItem {
  name: string;
  expression: string;
  value?: string | number;
  unit?: string;
  status: 'New' | 'Update' | 'Error' | 'Warning';
  previous?: string;
  message?: string;
}
export interface Preview {
  snapshotToken: string;
  items: PreviewItem[];
  valid: boolean;
}
export interface Calculation {
  value: string | number;
  unit: string;
  formatted: string;
}
export interface CleanupItem extends Parameter {
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
window.fusionJavaScriptHandler = {
  handle(action, raw) {
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
            'Could not connect to Autodesk Fusion. Open Paramood from Fusion and try Refresh.',
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
