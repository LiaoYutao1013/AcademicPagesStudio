/**
 * Jekyll front matter: splitting, parsing and serialising.
 *
 * The body is never reflowed; only the YAML block between the `---` fences is
 * regenerated. `js-yaml` is used for *reading* (schema-accurate) and for
 * *writing* a fresh header (there are no comments to preserve inside a
 * generated header), which is the opposite trade-off from `_config.yml`.
 */

import yaml from 'js-yaml';
import { AppError, codes } from '../util/errors.js';

/**
 * @typedef {object} DocumentParts
 * @property {boolean} hasFrontMatter
 * @property {string} frontMatterText
 * @property {Record<string, any>} data
 * @property {string} body
 * @property {string} eol
 * @property {{message: string, line: number|null} | null} error
 */

/**
 * @param {string} raw
 * @returns {DocumentParts}
 */
export function splitDocument(raw) {
  const text = String(raw ?? '');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const match = /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);

  if (!match) {
    return { hasFrontMatter: false, frontMatterText: '', data: {}, body: text, eol, error: null };
  }

  const frontMatterText = match[1];
  const body = text.slice(match[0].length);
  try {
    const parsed = yaml.load(frontMatterText);
    const data = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? /** @type {Record<string, any>} */ (parsed)
      : {};
    return { hasFrontMatter: true, frontMatterText, data, body, eol, error: null };
  } catch (err) {
    const mark = err && typeof err === 'object' && 'mark' in err ? err.mark : null;
    return {
      hasFrontMatter: true,
      frontMatterText,
      data: {},
      body,
      eol,
      error: { message: err instanceof Error ? err.message : String(err), line: mark ? mark.line + 1 : null },
    };
  }
}

/** Parse just the header of a file (used by the list view). */
export function parseFrontMatter(raw) {
  const parts = splitDocument(raw);
  if (parts.error) {
    throw new AppError(codes.FRONT_MATTER_INVALID, `Front Matter 解析失败: ${parts.error.message}`, parts.error);
  }
  return parts;
}

/**
 * Serialise a document. Dates are unquoted to match Academic Pages styling
 * (`date: 2025-11-06`), everything else uses js-yaml's block style.
 *
 * @param {Record<string, any>} data
 * @param {string} body
 * @param {{ eol?: string }} [opts]
 */
export function serializeDocument(data, body, opts = {}) {
  const eol = opts.eol ?? '\n';
  let header = yaml.dump(data, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
    quotingType: '"',
    forceQuotes: false,
    skipInvalid: true,
  });
  // js-yaml quotes ISO dates because it would otherwise re-read them as Date
  // objects; Jekyll expects an unquoted date here.
  header = header.replace(/^(date|last_modified_at|published): '(\d{4}-\d{2}-\d{2})'$/gm, '$1: $2');
  header = header.replace(/^(date|last_modified_at|published): "(\d{4}-\d{2}-\d{2})"$/gm, '$1: $2');

  if (eol !== '\n') header = header.replace(/\n/g, eol);

  let content = String(body ?? '');
  if (content !== '' && !content.startsWith('\n')) content = `\n${content}`;
  if (content === '') content = eol;
  if (!content.endsWith('\n')) content += eol;

  return `---${eol}${header}---${eol}${content}`;
}

/** Get a value from a flat map using a dotted path (`header.teaser`). */
export function getPath(flat, key) {
  return flat[key];
}

/**
 * Drop empty values so generated headers stay minimal, and drop a `header`
 * object that ended up empty.
 * @param {Record<string, any>} data
 */
export function pruneEmpty(data) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === 'object' && !Array.isArray(value)) {
      const nested = pruneEmpty(value);
      if (Object.keys(nested).length === 0) continue;
      out[key] = nested;
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * Set a possibly dotted key (`header.teaser`) on a nested object.
 * @param {Record<string, any>} target
 * @param {string} key
 * @param {unknown} value
 */
function setDeep(target, key, value) {
  if (!key.includes('.')) {
    target[key] = value;
    return;
  }
  const segments = key.split('.');
  let cursor = target;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i];
    if (!cursor[segment] || typeof cursor[segment] !== 'object' || Array.isArray(cursor[segment])) {
      cursor[segment] = {};
    }
    cursor = cursor[segment];
  }
  cursor[segments[segments.length - 1]] = value;
}

/**
 * Build an ordered front matter object from inherited defaults, form values,
 * a fixed key order, and preserved user keys.
 *
 * @param {{
 *   inherited?: Record<string, any>,
 *   ordered?: Array<{ key: string }>,
 *   values?: Record<string, any>,
 *   extra?: Record<string, any>,
 *   computed?: Record<string, any>,
 * }} input
 */
export function buildFrontMatter(input) {
  /** @type {Record<string, any>} */
  const out = {};

  // 1. inherited defaults from `_config.yml` (layout, author_profile, ...)
  for (const [key, value] of Object.entries(input.inherited ?? {})) out[key] = value;

  // 2. form fields, in template order
  const values = input.values ?? {};
  for (const field of input.ordered ?? []) {
    const value = values[field.key];
    if (value === undefined) continue;
    setDeep(out, field.key, value);
  }

  // 3. computed keys (collection, permalink)
  for (const [key, value] of Object.entries(input.computed ?? {})) out[key] = value;

  // 4. user's hand-written extra keys, untouched
  for (const [key, value] of Object.entries(input.extra ?? {})) {
    if (!(key in out)) out[key] = value;
  }

  return pruneEmpty(out);
}

/** Collect keys in `data` that the form does not manage. */
export function extraKeys(data, managed) {
  const known = new Set(managed);
  /** @type {Record<string, any>} */
  const extra = {};
  for (const [key, value] of Object.entries(data)) {
    if (!known.has(key)) extra[key] = value;
  }
  return extra;
}
