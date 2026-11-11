// Tiny global toast bus: any code (including the query client) can surface a message.
export type ToastKind = 'error' | 'success' | 'info';
export interface ToastDetail { message: string; kind: ToastKind }

export function toast(message: string, kind: ToastKind = 'info') {
  window.dispatchEvent(new CustomEvent<ToastDetail>('inspecta:toast', { detail: { message, kind } }));
}
