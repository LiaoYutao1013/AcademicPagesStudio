/**
 * `_data/navigation.yml` → `main:` list.
 *
 * Order in this file *is* the header order (see `_includes/masthead.html`),
 * so reordering rewrites the sequence body and nothing else. The nine-line
 * comment preamble above `main:` is outside the block and therefore survives
 * untouched.
 */

import { AppError, codes } from '../util/errors.js';
import { formatScalar, isBlank, needsQuoting, splitLines } from '../util/text.js';
import { parseYaml } from './siteConfig.js';
import { locateBlock, replaceBlockBody } from './yamlText.js';

/**
 * @typedef {object} NavItem
 * @property {string} title
 * @property {string} url
 */

/** @param {string} url */
export function isExternalUrl(url) {
  return /^https?:\/\//i.test(String(url ?? ''));
}

/** Any `scheme:` prefix (http:, javascript:, data:, ...). */
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/** Keys whose values are nested structures we cannot safely round-trip. */
function unsupportedKeys(item) {
  return Object.entries(item)
    .filter(([key, value]) => key !== 'title' && key !== 'url' && value !== null && typeof value === 'object')
    .map(([key]) => key);
}

/**
 * @param {string} text
 * @returns {{ items: NavItem[], blankBetween: boolean }}
 */
export function parseNavigation(text) {
  const data = parseYaml(text, '_data/navigation.yml');
  const main = data && data.main;
  if (!Array.isArray(main)) {
    throw new AppError(codes.VALIDATION, '_data/navigation.yml 缺少 main: 列表', { file: '_data/navigation.yml' });
  }

  const items = main.map((raw, index) => {
    if (!raw || typeof raw !== 'object') {
      throw new AppError(codes.VALIDATION, `main 第 ${index + 1} 项不是键值对`, { index });
    }
    const item = /** @type {Record<string, unknown>} */ (raw);
    return {
      ...item,
      title: item.title === null || item.title === undefined ? '' : String(item.title),
      url: item.url === null || item.url === undefined ? '' : String(item.url),
    };
  });

  return { items, blankBetween: detectBlankBetween(text) };
}

/** Preserve the file's existing spacing style between items. */
export function detectBlankBetween(text) {
  const { lines } = splitLines(text);
  const block = locateBlock(lines, 'main');
  let sawItem = false;
  for (let i = block.bodyStart; i < block.bodyEnd; i += 1) {
    if (isBlank(lines[i])) {
      if (sawItem) return true;
      continue;
    }
    if (/^[ \t]*-/.test(lines[i])) sawItem = true;
  }
  return false;
}

/**
 * Validate and normalise navigation items.
 * Errors block the write; warnings are informational.
 *
 * @param {NavItem[]} items
 */
export function validateNavigation(items) {
  /** @type {Array<{index: number, message: string}>} */
  const errors = [];
  /** @type {Array<{index: number, message: string}>} */
  const warnings = [];
  /** @type {Map<string, number>} */
  const seenUrl = new Map();
  /** @type {Map<string, number>} */
  const seenTitle = new Map();

  items.forEach((item, index) => {
    const title = String(item.title ?? '').trim();
    const url = String(item.url ?? '').trim();

    if (!title) errors.push({ index, message: '导航标题不能为空。' });
    if (!url) errors.push({ index, message: '导航 URL 不能为空。' });

    if (url && !isExternalUrl(url) && !url.startsWith('/') && !SCHEME_RE.test(url)) {
      warnings.push({ index, message: '内部链接建议以 / 开头（会自动补全）。' });
    }
    if (SCHEME_RE.test(url) && !isExternalUrl(url)) {
      errors.push({ index, message: `只支持 http(s) 链接或站内路径，拒绝 "${url.split(':')[0]}:" 协议。` });
    }
    if (/\s/.test(url)) {
      errors.push({ index, message: 'URL 不能包含空格。' });
    }
    for (const key of unsupportedKeys(item)) {
      warnings.push({ index, message: `字段 "${key}" 是嵌套结构，应用暂不支持编辑，保存时会被忽略。` });
    }
    if (seenUrl.has(url)) {
      warnings.push({ index, message: `URL "${url}" 与第 ${seenUrl.get(url) + 1} 项重复。` });
    } else {
      seenUrl.set(url, index);
    }
    if (seenTitle.has(title)) {
      warnings.push({ index, message: `标题 "${title}" 与第 ${seenTitle.get(title) + 1} 项重复。` });
    } else {
      seenTitle.set(title, index);
    }
  });

  return { errors, warnings };
}

/**
 * Normalise (trim, prefix internal URLs) without mutating the input.
 * @param {NavItem[]} items
 * @returns {NavItem[]}
 */
export function normalizeItems(items) {
  return items.map((item) => {
    const title = String(item.title ?? '').trim();
    let url = String(item.url ?? '').trim();
    if (url && !isExternalUrl(url) && !SCHEME_RE.test(url) && !url.startsWith('/')) url = `/${url}`;
    /** @type {NavItem} */
    const out = { ...item, title, url };
    return out;
  });
}

/**
 * Serialise `main:` items. `title` and `url` are emitted first, in that
 * order; any additional user keys are preserved afterwards.
 *
 * @param {NavItem[]} items
 * @param {{ childIndent?: number, blankBetween?: boolean }} [opts]
 * @returns {string[]} lines, already indented for the `main:` block
 */
export function serializeNavigation(items, opts = {}) {
  const childIndent = opts.childIndent ?? 2;
  const blankBetween = opts.blankBetween ?? true;
  /** @type {string[]} */
  const lines = [];

  items.forEach((item, index) => {
    if (index > 0 && blankBetween) lines.push('');

    /** @type {Array<[string, unknown]>} */
    const entries = [];
    const extras = Object.entries(item).filter(([key, value]) => (
      key !== 'title'
      && key !== 'url'
      && value !== undefined
      && value !== null
      && typeof value !== 'object'
    ));
    entries.push(['title', item.title]);
    entries.push(['url', item.url]);
    entries.push(...extras);

    entries.forEach(([key, value], entryIndex) => {
      const prefix = entryIndex === 0
        ? `${' '.repeat(childIndent)}- `
        : `${' '.repeat(childIndent + 2)}`;
      const style = key === 'title' ? 'double' : 'plain';
      const token = formatScalar(value, style, { forceQuote: key === 'title' });
      lines.push(`${prefix}${key}:${token ? ` ${token}` : ''}`);
    });
  });

  return lines;
}

/**
 * Replace the `main:` sequence with the given items.
 *
 * @param {string} text
 * @param {NavItem[]} items
 * @param {{ blankBetween?: boolean }} [opts]
 * @returns {{ text: string, items: NavItem[], warnings: Array<{index: number, message: string}> }}
 */
export function updateNavigation(text, items, opts = {}) {
  const normalized = normalizeItems(items);
  const { errors, warnings } = validateNavigation(normalized);
  if (errors.length) {
    throw new AppError(codes.VALIDATION, errors[0].message, { errors, warnings });
  }
  const blankBetween = opts.blankBetween ?? detectBlankBetween(text);
  const body = serializeNavigation(normalized, { blankBetween });
  const next = replaceBlockBody(text, 'main', body);
  return { text: next, items: normalized, warnings };
}

/** Pure reorder helper used by the drag-and-drop list. */
export function moveItem(items, from, to) {
  const next = [...items];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** URL a generated archive page will live at. */
export function collectionUrl(label) {
  return `/${String(label).replace(/^_+/, '')}/`;
}
