/**
 * Thin accessor around the preload bridge (`window.studio`).
 *
 * The renderer never talks to Node/Electron directly; every call goes through
 * this object so a missing preload fails loudly and in one place.
 */

export function studio() {
  const bridge = typeof window === 'undefined' ? null : window.studio;
  if (!bridge) {
    const error = new Error('渲染进程未连接到主进程（preload 未加载），请重启应用');
    error.code = 'BRIDGE_MISSING';
    error.details = {};
    throw error;
  }
  return bridge;
}

/** Human readable message for an IPC failure. */
export function messageOf(err, fallback = '操作失败') {
  if (!err) return fallback;
  const message = typeof err.message === 'string' ? err.message.trim() : '';
  return message || fallback;
}

/** `GIT_CONFLICT` carries the conflicting files in `details.files`. */
export function conflictFiles(err) {
  if (!err || err.code !== 'GIT_CONFLICT') return [];
  const files = err.details && Array.isArray(err.details.files) ? err.details.files : [];
  return files.filter(Boolean).map(String);
}

/** Validation errors from services look like `[{ key?, index?, message }]`. */
export function detailList(err, name) {
  const list = err && err.details ? err.details[name] : null;
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => (item && typeof item === 'object' ? String(item.message ?? '') : String(item ?? '')))
    .filter(Boolean);
}
