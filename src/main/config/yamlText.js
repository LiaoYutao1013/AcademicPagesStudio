/**
 * Comment-preserving YAML editing ("surgery").
 *
 * Why not `yaml.dump(config)`?
 *   A full parse → dump cycle loses every comment, all alignment and the
 *   existing key order. On an Academic Pages `_config.yml` (361 lines, ~90
 *   comments) that is an unacceptable diff.
 *
 * Why not a CST library (`yaml` by eemeli)?
 *   It preserves comments attached to nodes but still re-indents and can
 *   collapse blank lines; more importantly it replaces the whole document, so
 *   a bug in node placement rewrites the file. The operations we need are few
 *   and local: "change these scalar values", "replace this top-level
 *   sequence", "append this entry". Doing that as line-range splices means a
 *   diff contains *only* the bytes we intended to change.
 *
 * Strategy:
 *   - `locateBlock` finds the line range of a top-level block (`author:`).
 *   - `setMappingValues` rewrites only the value token of each field, keeping
 *     the original prefix (`  avatar           : `), quote style and comment.
 *   - `replaceBlockBody` splices a whole block body (navigation list).
 *   - `appendMappingEntry` / `appendSequenceEntry` add entries at the end of a
 *     block, leaving everything else byte-identical.
 *
 * Every function here is pure (text in, text out) so the whole layer is
 * covered by unit tests against the real repository files.
 */

import { AppError, codes } from '../util/errors.js';
import {
  formatScalar,
  indentWidth,
  isBlank,
  isCommentOnly,
  joinLines,
  parseScalarToken,
  splitInlineComment,
  splitLines,
} from '../util/text.js';

/**
 * @typedef {object} Block
 * @property {string} key
 * @property {number} keyLine
 * @property {number} keyIndent
 * @property {number} bodyStart first line after the key line
 * @property {number} bodyEnd exclusive end of the block body (content only)
 */

/**
 * @typedef {object} MappingEntry
 * @property {string} key
 * @property {number} lineIndex
 * @property {string} head everything up to and including whitespace after ':'
 * @property {unknown} value
 * @property {'empty'|'double'|'single'|'plain'} style
 * @property {string} comment trailing comment without leading whitespace
 */

const KEY_LINE_CACHE = new Map();

/** @param {string} key */
function keyLineRegex(key) {
  let re = KEY_LINE_CACHE.get(key);
  if (!re) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp(`^([ \\t]*)${escaped}[ \\t]*:(?:[ \\t]+.*)?$`);
    KEY_LINE_CACHE.set(key, re);
  }
  return re;
}

/** Measure the most common colon column so appended keys stay aligned. */
function modeColonColumn(entries) {
  /** @type {Map<number, number>} */
  const counts = new Map();
  for (const entry of entries.values()) {
    const colon = entry.head.lastIndexOf(':');
    if (colon <= 0) continue;
    counts.set(colon, (counts.get(colon) ?? 0) + 1);
  }
  let best = -1;
  let bestCount = 0;
  for (const [col, count] of counts) {
    if (count > bestCount || (count === bestCount && col > best)) {
      best = col;
      bestCount = count;
    }
  }
  return best;
}

/** Two spaces unless the file clearly uses another width. */
function detectIndentUnit(entries) {
  const widths = [];
  for (const entry of entries.values()) {
    const indent = indentWidth(' '.repeat(entry.head.search(/\S/)));
    const width = indent - 0;
    if (width > 0 && width <= 4) widths.push(width);
  }
  if (!widths.length) return 2;
  const counts = new Map();
  for (const w of widths) counts.set(w, (counts.get(w) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Find a top-level block such as `author:` or `collections:`.
 *
 * The block ends at the first non-blank line indented at or below the key.
 * A comment at column 0 therefore terminates the block, which is exactly what
 * we want: section comments belong to the *next* section and must not be
 * swallowed when the block is rewritten.
 *
 * @param {string[]} lines
 * @param {string} key
 * @param {{ indent?: number }} [opts]
 * @returns {Block}
 */
export function locateBlock(lines, key, opts = {}) {
  const wantIndent = opts.indent ?? 0;
  const re = keyLineRegex(key);
  for (let i = 0; i < lines.length; i += 1) {
    const match = re.exec(lines[i]);
    if (!match) continue;
    if (match[1].length !== wantIndent) continue;

    const keyIndent = match[1].length;
    let lastContent = i;
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j];
      if (isBlank(line)) continue;
      if (indentWidth(line) > keyIndent) {
        lastContent = j;
        continue;
      }
      break;
    }
    return { key, keyLine: i, keyIndent, bodyStart: i + 1, bodyEnd: lastContent + 1 };
  }
  throw new AppError(codes.CONFIG_BLOCK_MISSING, `_config.yml 中找不到顶层块 "${key}:"`, { key });
}

/**
 * Does a top-level block exist? (non-throwing variant of locateBlock)
 * @param {string} text
 * @param {string} key
 */
export function hasTopLevelBlock(text, key) {
  const { lines } = splitLines(text);
  try {
    locateBlock(lines, key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse the direct scalar entries of a mapping block.
 * Nested mappings and sequences are ignored (they are not edited field-by-field).
 *
 * @param {string[]} lines
 * @param {Block} block
 * @returns {Map<string, MappingEntry>}
 */
export function parseMappingBlock(lines, block) {
  /** @type {Map<string, MappingEntry>} */
  const entries = new Map();
  for (let i = block.bodyStart; i < block.bodyEnd; i += 1) {
    const line = lines[i];
    if (isBlank(line) || isCommentOnly(line)) continue;
    // Sequence items (`  - title: "About"`) are not mapping entries.
    if (/^[ \t]*-/.test(line)) continue;

    const match = /^([ \t]+)([^\s:#][^:]*?)([ \t]*):(.*)$/.exec(line);
    if (!match) continue;

    const [, indent, key, gapBefore, rest] = match;
    const { code, comment } = splitInlineComment(rest);
    const lead = /^[ \t]*/.exec(code)[0];
    const valueToken = code.slice(lead.length);
    const { value, style } = parseScalarToken(valueToken);

    entries.set(key, {
      key,
      lineIndex: i,
      head: `${indent}${key}${gapBefore}:${lead}`,
      value,
      style,
      comment,
    });
  }
  return entries;
}

/**
 * Patch scalar values inside a top-level mapping block, in place.
 *
 * Untouched lines are never rewritten; edited lines keep their exact prefix
 * (indentation, key, alignment spaces, quote style) and their trailing
 * comment. Missing keys are appended at the end of the block, aligned with the
 * existing colon column.
 *
 * @param {string} text
 * @param {string} blockKey e.g. 'author'
 * @param {Record<string, unknown>} patch `null`/`''` clears a field
 * @returns {{ text: string, changedKeys: string[], addedKeys: string[] }}
 */
export function setMappingValues(text, blockKey, patch) {
  const { lines, eol, hasFinalEol } = splitLines(text);
  const block = locateBlock(lines, blockKey);

  for (let i = block.bodyStart; i < block.bodyEnd; i += 1) {
    if (/^[ \t]*\t/.test(lines[i])) {
      throw new AppError(codes.VALIDATION, `"${blockKey}:" 块使用了 Tab 缩进，无法安全改写`, {
        block: blockKey,
        line: i + 1,
      });
    }
  }

  const entries = parseMappingBlock(lines, block);
  const indentUnit = detectIndentUnit(entries);
  const colonColumn = modeColonColumn(entries);
  const changedKeys = [];
  const addedKeys = [];
  /** @type {string[]} */
  const pending = [];
  let insertAt = block.bodyEnd;

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const entry = entries.get(key);
    if (entry) {
      const token = formatScalar(value, entry.style);
      // A field that was empty (`key:`) has no space after the colon; adding a
      // value without one would turn the line into a plain scalar and corrupt
      // the block. Insert exactly one space in that case.
      let head = entry.head;
      if (token && !/[ \t]$/.test(head)) head += ' ';
      let next;
      if (token) {
        next = `${head}${token}${entry.comment ? ` ${entry.comment}` : ''}`;
      } else if (entry.comment) {
        next = `${head}${/[ \t]$/.test(head) ? '' : ' '}${entry.comment}`;
      } else {
        next = head.replace(/[ \t]+$/, '');
      }
      if (next !== lines[entry.lineIndex]) {
        lines[entry.lineIndex] = next;
        changedKeys.push(key);
      }
      continue;
    }

    const indent = ' '.repeat(block.keyIndent + indentUnit);
    const targetColon = colonColumn > 0 ? colonColumn : indent.length + key.length + 1;
    const pad = Math.max(1, targetColon - indent.length - key.length);
    const token = formatScalar(value, 'empty');
    const line = `${indent}${key}${' '.repeat(pad)}:${token ? ` ${token}` : ''}`;
    pending.push(line);
    addedKeys.push(key);
  }

  if (pending.length) {
    // Append after the last content line, before any trailing blank lines.
    if (block.bodyEnd === block.bodyStart) {
      lines.splice(insertAt, 0, ...pending);
    } else {
      const lastLine = lines[insertAt - 1];
      if (!lastLine.endsWith('\n') && /[^ \t]$/.test(lastLine)) {
        // nothing to do; insertAt already points after content
      }
      lines.splice(insertAt, 0, ...pending);
    }
  }

  return { text: joinLines(lines, eol, hasFinalEol), changedKeys, addedKeys };
}

/**
 * Replace the body of a top-level block with new lines.
 * Everything outside `[bodyStart, bodyEnd)` is preserved byte-for-byte,
 * including the section comments above and the blank lines below.
 *
 * @param {string} text
 * @param {string} blockKey
 * @param {string[]} bodyLines
 * @returns {string}
 */
export function replaceBlockBody(text, blockKey, bodyLines) {
  const { lines, eol, hasFinalEol } = splitLines(text);
  const block = locateBlock(lines, blockKey);
  const next = [...lines.slice(0, block.bodyStart), ...bodyLines, ...lines.slice(block.bodyEnd)];

  // Keep a blank line between the block and the following top-level key.
  const afterIndex = block.bodyStart + bodyLines.length;
  if (bodyLines.length && afterIndex < next.length && !isBlank(next[afterIndex])) {
    next.splice(afterIndex, 0, '');
  }
  return joinLines(next, eol, hasFinalEol);
}

/**
 * Append `key:` plus a nested body at the end of a mapping block
 * (used for `collections:`).
 *
 * @param {string} text
 * @param {string} blockKey
 * @param {string} entryKey
 * @param {string[]} bodyLines relative to the entry (no base indent)
 * @param {{ comment?: string }} [opts]
 * @returns {string}
 */
export function appendMappingEntry(text, blockKey, entryKey, bodyLines, opts = {}) {
  const { lines, eol, hasFinalEol } = splitLines(text);
  const block = locateBlock(lines, blockKey);
  const entries = parseMappingBlock(lines, block);

  if (entries.has(entryKey)) {
    throw new AppError(codes.CONFIG_DUPLICATE_KEY, `"${blockKey}:" 中已存在 "${entryKey}"`, {
      block: blockKey,
      key: entryKey,
    });
  }

  const base = ' '.repeat(block.keyIndent + detectIndentUnit(entries));
  const childBase = `${base}  `;
  /** @type {string[]} */
  const added = [];
  if (opts.comment) added.push(`${base}${opts.comment}`);
  added.push(`${base}${entryKey}:`);
  for (const line of bodyLines) {
    added.push(line === '' ? '' : `${childBase}${line}`);
  }

  lines.splice(block.bodyEnd, 0, ...added);
  const nextIndex = block.bodyEnd + added.length;
  if (nextIndex < lines.length && !isBlank(lines[nextIndex])) lines.splice(nextIndex, 0, '');
  return joinLines(lines, eol, hasFinalEol);
}

/**
 * Indentation of sequence items (`- scope:`) inside a block. A `defaults:`
 * entry nests its keys at 6 spaces, so the nested-key indentation must not be
 * mistaken for the item indentation.
 *
 * @param {string[]} lines
 * @param {Block} block
 */
function sequenceItemIndent(lines, block) {
  for (let i = block.bodyStart; i < block.bodyEnd; i += 1) {
    const match = /^([ \t]*)-[ \t]/.exec(lines[i]);
    if (match) return match[1].length;
  }
  return block.keyIndent + 2;
}

/**
 * Append a sequence item (`- scope:` ...) at the end of a top-level sequence
 * block (used for `defaults:`).
 *
 * @param {string} text
 * @param {string} blockKey
 * @param {string[]} itemLines relative to the item; first line usually `- scope:`
 * @param {{ comment?: string }} [opts]
 * @returns {string}
 */
export function appendSequenceEntry(text, blockKey, itemLines, opts = {}) {
  const { lines, eol, hasFinalEol } = splitLines(text);
  const block = locateBlock(lines, blockKey);
  const base = ' '.repeat(sequenceItemIndent(lines, block));

  /** @type {string[]} */
  const added = [];
  if (opts.comment) added.push(`${base}${opts.comment}`);
  for (const line of itemLines) {
    added.push(line === '' ? '' : `${base}${line}`);
  }

  lines.splice(block.bodyEnd, 0, ...added);
  return joinLines(lines, eol, hasFinalEol);
}

/**
 * Read a top-level mapping block as a plain object (scalar values only).
 * @param {string} text
 * @param {string} blockKey
 */
export function readMappingBlock(text, blockKey) {
  const { lines } = splitLines(text);
  const block = locateBlock(lines, blockKey);
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, entry] of parseMappingBlock(lines, block)) out[key] = entry.value;
  return out;
}

/**
 * Extract the raw lines of a block body.
 * @param {string} text
 * @param {string} blockKey
 */
export function readBlockBody(text, blockKey) {
  const { lines } = splitLines(text);
  const block = locateBlock(lines, blockKey);
  return lines.slice(block.bodyStart, block.bodyEnd);
}
