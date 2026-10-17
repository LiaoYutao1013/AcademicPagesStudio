/**
 * Small pure formatting helpers shared by the views.
 *
 * Front matter values arrive as plain JSON but js-yaml can turn `date:` into a
 * `Date`, and list fields arrive as arrays; both need normalising before they
 * reach an `<input>`.
 */

const pad2 = (value) => String(value).padStart(2, '0');

/** Local `YYYY-MM-DD` (not UTC: the file name and Jekyll both use local time). */
export function todayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/** Any scalar/Date/array → a string an input can display. */
export function toInputString(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return value.toISOString().slice(0, 10);
  }
  if (Array.isArray(value)) return value.map((item) => toInputString(item)).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return String(value);
}

/** YAML list / array → comma separated text for the form. */
export function listToText(value) {
  if (Array.isArray(value)) return value.map((item) => toInputString(item)).filter(Boolean).join(', ');
  return toInputString(value);
}

/** Comma separated text → `string[]` (trimmed, empties dropped). */
export function splitList(text) {
  return String(text ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Read a dotted key out of an object (`flatData['header.teaser']` style maps). */
export function getKey(map, key) {
  return map ? map[key] : undefined;
}

export function baseName(filePath) {
  const text = String(filePath ?? '');
  const index = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'));
  return index >= 0 ? text.slice(index + 1) : text;
}

export function dirName(filePath) {
  const text = String(filePath ?? '');
  const index = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'));
  return index >= 0 ? text.slice(0, index) : '';
}

/** Display an ISO timestamp (`git log` `%aI`) as `YYYY-MM-DD HH:mm`. */
export function formatDateTime(value) {
  const text = String(value ?? '');
  if (!text) return '';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text.slice(0, 16).replace('T', ' ');
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function formatTime(date) {
  const value = date instanceof Date ? date : new Date();
  return `${pad2(value.getHours())}:${pad2(value.getMinutes())}:${pad2(value.getSeconds())}`;
}

/** `_posts/2025-01-02-hello.md` → `2025-01-02-hello.md` */
export function shortPath(filePath, max = 52) {
  const text = String(filePath ?? '');
  if (text.length <= max) return text;
  return `…${text.slice(-(max - 1))}`;
}

export function plural(count, unit) {
  return `${count} ${unit}`;
}

/** Render an arbitrary YAML value for a read-only chip. */
export function formatValue(value) {
  if (value === null || value === undefined) return '空';
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (Array.isArray(value)) return value.map((item) => formatValue(item)).join(', ');
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '[对象]';
    }
  }
  return String(value);
}

/** Default commit message offered in the sync view. */
export const DEFAULT_COMMIT_MESSAGE = 'Update content from Academic Pages Studio';

/** `main` / `master` / feature branch → safe short label. */
export function branchLabel(branch) {
  return String(branch ?? '').trim() || 'HEAD';
}
