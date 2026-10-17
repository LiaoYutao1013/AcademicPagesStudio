/**
 * Minimal LCS line diff for the "预览后再推送" confirmation screens.
 * Config files are a few hundred lines, so the O(n·m) table is fine; a hard
 * cap keeps a pathological file from freezing the main process.
 */

const MAX_CELLS = 4_000_000;

/**
 * @param {string} before
 * @param {string} after
 * @param {{ context?: number }} [opts]
 * @returns {{
 *   hunks: Array<{ header: string, lines: Array<{ type: 'add'|'del'|'context', text: string }> }>,
 *   added: number,
 *   removed: number,
 *   changed: boolean,
 * }}
 */
export function diffLines(before, after, opts = {}) {
  const context = opts.context ?? 3;
  const a = String(before ?? '').split(/\r?\n/);
  const b = String(after ?? '').split(/\r?\n/);

  if (a.length * b.length > MAX_CELLS) {
    // Fall back to "everything replaced" for huge inputs.
    return {
      hunks: [{
        header: `@@ -1,${a.length} +1,${b.length} @@`,
        lines: [
          ...a.map((text) => ({ type: 'del', text })),
          ...b.map((text) => ({ type: 'add', text })),
        ],
      }],
      added: b.length,
      removed: a.length,
      changed: before !== after,
    };
  }

  // LCS table of edit distances.
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  /** @type {Array<{ type: 'add'|'del'|'context', text: string, aLine: number, bLine: number }>} */
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ type: 'context', text: a[i], aLine: i + 1, bLine: j + 1 });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ type: 'del', text: a[i], aLine: i + 1, bLine: j + 1 });
      i += 1;
    } else {
      ops.push({ type: 'add', text: b[j], aLine: i + 1, bLine: j + 1 });
      j += 1;
    }
  }
  while (i < a.length) {
    ops.push({ type: 'del', text: a[i], aLine: i + 1, bLine: j + 1 });
    i += 1;
  }
  while (j < b.length) {
    ops.push({ type: 'add', text: b[j], aLine: i + 1, bLine: j + 1 });
    j += 1;
  }

  const changedIndices = ops.map((op, index) => (op.type === 'context' ? -1 : index)).filter((n) => n >= 0);
  /** @type {Array<{ header: string, lines: Array<{type: string, text: string}> }>} */
  const hunks = [];
  if (changedIndices.length) {
    let start = Math.max(0, changedIndices[0] - context);
    let end = Math.min(ops.length - 1, changedIndices[0] + context);
    for (const index of changedIndices.slice(1)) {
      if (index - context <= end + 1) {
        end = Math.min(ops.length - 1, index + context);
      } else {
        hunks.push(makeHunk(ops, start, end));
        start = Math.max(0, index - context);
        end = Math.min(ops.length - 1, index + context);
      }
    }
    hunks.push(makeHunk(ops, start, end));
  }

  return {
    hunks,
    added: ops.filter((op) => op.type === 'add').length,
    removed: ops.filter((op) => op.type === 'del').length,
    changed: before !== after,
  };
}

function makeHunk(ops, start, end) {
  const slice = ops.slice(start, end + 1);
  const aStart = slice[0]?.aLine ?? 1;
  const bStart = slice[0]?.bLine ?? 1;
  const aCount = slice.filter((op) => op.type !== 'add').length;
  const bCount = slice.filter((op) => op.type !== 'del').length;
  return {
    header: `@@ -${aStart},${aCount} +${bStart},${bCount} @@`,
    lines: slice.map(({ type, text }) => ({ type, text })),
  };
}
