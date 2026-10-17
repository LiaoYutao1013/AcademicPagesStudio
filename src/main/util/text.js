/**
 * Low-level text helpers shared by the YAML surgery layer and the writers.
 * Pure functions only — no fs, so they are trivially unit-testable.
 */

/**
 * Split a text file into lines while remembering its newline convention.
 * @param {string} text
 * @returns {{ lines: string[], eol: string, hasFinalEol: boolean }}
 */
export function splitLines(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const normalised = text.replace(/\r\n/g, '\n');
  const hasFinalEol = normalised.endsWith('\n');
  const lines = normalised.split('\n');
  if (hasFinalEol) lines.pop();
  return { lines, eol, hasFinalEol };
}

/**
 * @param {string[]} lines
 * @param {string} eol
 * @param {boolean} hasFinalEol
 */
export function joinLines(lines, eol, hasFinalEol = true) {
  return lines.join(eol) + (hasFinalEol ? eol : '');
}

/**
 * Visual indentation width. Tabs are rejected by the config writer, but we
 * still measure them as 1 so that block detection does not crash on read.
 * @param {string} line
 */
export function indentWidth(line) {
  const m = /^[ \t]*/.exec(line);
  return m ? m[0].length : 0;
}

/** @param {string} line */
export function isBlank(line) {
  return line.trim() === '';
}

/** @param {string} line */
export function isCommentOnly(line) {
  return /^[ \t]*#/.test(line);
}

/**
 * Split a YAML line into the code part and the trailing comment part.
 *
 * A `#` only starts a comment when it is at the start of the fragment or is
 * preceded by whitespace and is not inside a quoted scalar (YAML 1.2 §6.2).
 *
 * @param {string} fragment
 * @returns {{ code: string, comment: string }} `comment` keeps no leading spaces
 */
export function splitInlineComment(fragment) {
  /** @type {null | '"' | "'"} */
  let quote = null;
  for (let i = 0; i < fragment.length; i += 1) {
    const ch = fragment[i];
    if (quote) {
      if (quote === '"' && ch === '\\') {
        i += 1; // skip escaped char
        continue;
      }
      if (ch === quote) {
        if (quote === "'" && fragment[i + 1] === "'") {
          i += 1; // '' escape inside single quotes
          continue;
        }
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#' && (i === 0 || /\s/.test(fragment[i - 1]))) {
      return { code: fragment.slice(0, i), comment: fragment.slice(i) };
    }
  }
  return { code: fragment, comment: '' };
}

/**
 * @param {string} raw trimmed scalar token
 * @returns {{ value: unknown, style: 'empty'|'double'|'single'|'plain' }}
 */
export function parseScalarToken(raw) {
  const token = raw.trim();
  if (token === '' || token === '~' || token === 'null') {
    return { value: null, style: 'empty' };
  }
  if (token.length >= 2 && token.startsWith('"') && token.endsWith('"')) {
    try {
      return { value: JSON.parse(token), style: 'double' };
    } catch {
      return { value: token.slice(1, -1), style: 'double' };
    }
  }
  if (token.length >= 2 && token.startsWith("'") && token.endsWith("'")) {
    return { value: token.slice(1, -1).replace(/''/g, "'"), style: 'single' };
  }
  return { value: token, style: 'plain' };
}

/**
 * Does a plain (unquoted) scalar need quoting to survive a YAML round trip?
 * @param {string} value
 */
export function needsQuoting(value) {
  if (value === '') return true;
  if (value !== value.trim()) return true;
  if (/[\r\n\t]/.test(value)) return true;
  // YAML 1.1 booleans / nulls: Jekyll uses Psych (1.1), so yes/no/on/off are
  // coerced to booleans unless quoted.
  if (/^(true|false|null|~|yes|no|on|off)$/i.test(value)) return true;
  // Looks like a number or a date — quoting keeps it a string.
  if (/^[-+]?(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(value)) return true;
  if (/^\d{4}-\d{2}-\d{2}(?:[ T].*)?$/.test(value)) return true;
  // Flow indicators, anchors, tags, directives, leading indicators.
  if (/^[[\]{}&*!|>'"%@`,?:#-]/.test(value)) return true;
  // ": " or " #" inside a plain scalar terminates/annotates it.
  if (/: |\s#/.test(value)) return true;
  if (value.endsWith(':')) return true;
  return false;
}

/**
 * Serialise a scalar for writing back into a YAML block.
 *
 * `style` is the style the field already used in the file, so a quoted bio
 * stays quoted and a plain URL stays plain: the diff only touches the value.
 *
 * @param {unknown} value
 * @param {'empty'|'double'|'single'|'plain'} [style]
 * @param {{ forceQuote?: boolean }} [opts]
 * @returns {string} serialised token, '' for null/undefined/empty-string
 */
export function formatScalar(value, style = 'plain', opts = {}) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  const str = String(value);
  if (str === '') return '';

  const quote = () => JSON.stringify(str);
  switch (style) {
    case 'double':
      return quote();
    case 'single':
      return `'${str.replace(/'/g, "''")}'`;
    case 'empty':
      // Field was blank; keep it unquoted unless the value would break YAML.
      return opts.forceQuote || needsQuoting(str) ? quote() : str;
    default:
      return opts.forceQuote || needsQuoting(str) ? quote() : str;
  }
}

/** Convert any string to a URL/file-name safe slug (ASCII, kebab-case). */
export function slugify(input) {
  const text = String(input ?? '').normalize('NFKD');
  const ascii = text.replace(/[\u0300-\u036f]/g, '');
  const slug = ascii
    .toLowerCase()
    .replace(/['"`]/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug;
}

/** YYYY-MM-DD in local time. */
export function todayISO(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
