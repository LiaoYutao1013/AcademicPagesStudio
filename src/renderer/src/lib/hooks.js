/** Shared React hooks. */

import { useEffect, useRef, useState } from 'react';

/** Value that lags behind `value` by `delay` ms (for live validation). */
export function useDebouncedValue(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Ref that is `true` while the component is mounted (guards async setState). */
export function useMountedRef() {
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  return mounted;
}

/** Latest-value ref, for handlers passed into long-lived subscriptions. */
export function useLatest(value) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/**
 * Keep a document-level keyboard shortcut alive without re-binding every
 * render (used for Ctrl/Cmd+S in the editor).
 *
 * @param {(event: KeyboardEvent) => void} handler
 */
export function useDocumentKeydown(handler) {
  const latest = useLatest(handler);
  useEffect(() => {
    const listener = (event) => latest.current(event);
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, [latest]);
}
