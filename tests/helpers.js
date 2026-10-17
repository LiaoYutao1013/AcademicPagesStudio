/**
 * Test helpers: fixture snapshots of the real repository files plus throwaway
 * workspaces, so the suite never touches the user's blog repository.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const FIXTURES = path.join(import.meta.dirname, 'fixtures');

/** @param {string} name */
export async function readFixture(name) {
  return fs.readFile(path.join(FIXTURES, name), 'utf8');
}

/** Fixture with CRLF collapsed, for regex assertions that do not test EOLs. */
export async function readFixtureLf(name) {
  return (await readFixture(name)).replace(/\r\n/g, '\n');
}

export function toLines(text) {
  return text.replace(/\r\n/g, '\n').split('\n');
}

export function commentLines(text) {
  return toLines(text).filter((line) => /^\s*#/.test(line));
}

/**
 * Temporary Academic Pages repository with the real config/navigation files
 * and the content directories the app expects.
 */
export async function makeTempRepo() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aps-studio-'));
  for (const dir of [
    '_data',
    '_layouts',
    '_includes',
    '_pages',
    '_posts',
    '_drafts',
    '_publications',
    '_talks',
    '_teaching',
    '_portfolio',
  ]) {
    await fs.mkdir(path.join(root, dir), { recursive: true });
  }
  await fs.writeFile(path.join(root, '_config.yml'), await readFixture('_config.yml'), 'utf8');
  await fs.writeFile(path.join(root, '_data', 'navigation.yml'), await readFixture('navigation.yml'), 'utf8');
  return {
    root,
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  };
}

/** @param {string} dir */
export async function listTree(dir) {
  /** @type {string[]} */
  const out = [];
  async function walk(current, prefix) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(current, entry.name), rel);
      else out.push(rel);
    }
  }
  await walk(dir, '');
  return out.sort();
}
