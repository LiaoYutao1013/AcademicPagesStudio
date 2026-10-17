import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import { messageOf } from '../lib/api.js';

const ToastContext = createContext(null);

let nextId = 0;

/**
 * Toast stack: renders itself, exposes `push(message, tone)` / `pushError(err)`.
 * Toasts are intentionally transient; blocking problems are shown inline by the
 * view that owns them.
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (message, tone = 'info', options = {}) => {
      const id = (nextId += 1);
      const text = typeof message === 'string' && message.trim() ? message.trim() : '操作失败';
      const duration = options.duration ?? (tone === 'error' ? 7000 : 4000);
      setToasts((list) => [...list.slice(-4), { id, message: text, tone }]);
      window.setTimeout(() => dismiss(id), duration);
      return id;
    },
    [dismiss],
  );

  const pushError = useCallback(
    (err, fallback = '操作失败') => push(messageOf(err, fallback), 'error'),
    [push],
  );

  const value = useMemo(() => ({ push, pushError, dismiss }), [push, pushError, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.tone}`}>
            <span className="toast-mark" aria-hidden="true" />
            <span className="toast-text">{toast.message}</span>
            <button
              type="button"
              className="toast-close"
              aria-label="关闭通知"
              onClick={() => dismiss(toast.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast 必须在 <ToastProvider> 内使用');
  return context;
}
