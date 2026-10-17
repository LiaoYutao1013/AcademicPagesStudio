/**
 * Filesystem helpers with the safety properties the app depends on:
 * atomic writes (no half-written `_config.yml` if the process dies),
 * repository-contained path resolution, and snapshot/restore for rollback.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { AppError, codes } from './errors.js';

const MAX_TEXT_BYTES = 8 * 1024 * 1024;

/**
 * Resolve `rel` inside `root`, rejecting `..` escapes and absolute paths.
 * @param {string} root
 * @param {string} rel
 * @returns {string} absolute path
 */
export function resolveInside(root, rel) {
  const rootAbs = path.resolve(root);
  const target = path.resolve(rootAbs, rel);
  const rootWithSep = rootAbs.endsWith(path.sep) ? rootAbs : rootAbs + path.sep;
  if (target !== rootAbs && !target.startsWith(rootWithSep)) {
    throw new AppError(codes.FILE_OUTSIDE_REPO, `路径越出仓库范围: ${rel}`, { rel });
  }
  return target;
}

/** Repository-relative, POSIX-style path (what git and Jekyll both use). */
export function toRepoPath(root, absPath) {
  return path.relative(path.resolve(root), absPath).split(path.sep).join('/');
}

/** @param {string} file */
export async function readTextFile(file) {
  const stat = await fs.stat(file).catch(() => null);
  if (!stat) throw new AppError(codes.FILE_NOT_FOUND, `文件不存在: ${file}`, { file });
  if (stat.size > MAX_TEXT_BYTES) {
    throw new AppError(codes.VALIDATION, `文件超过 ${MAX_TEXT_BYTES / 1024 / 1024}MB，拒绝以文本方式打开`, { file, size: stat.size });
  }
  return fs.readFile(file, 'utf8');
}

/**
 * Write via a sibling temp file + rename. `mode` keeps 0644-style defaults.
 * @param {string} file
 * @param {string} content
 */
export async function writeTextFileAtomic(file, content) {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    await fs.writeFile(tmp, content, 'utf8');
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

/** @param {string} file */
export async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Binary-safe atomic write (assets are copied byte-for-byte).
 * @param {string} file
 * @param {Buffer | Uint8Array} bytes
 */
export async function writeBinaryFileAtomic(file, bytes) {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    await fs.writeFile(tmp, bytes);
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

/** @param {string} file */
export async function statOrNull(file) {
  try {
    return await fs.stat(file);
  } catch {
    return null;
  }
}

/**
 * Snapshot a list of files, apply a mutation, and roll back on failure.
 * Used by multi-file operations (new collection = config + page + nav).
 *
 * @template T
 * @param {string} root
 * @param {string[]} relPaths
 * @param {() => Promise<T>} mutate
 * @returns {Promise<T>}
 */
export async function withRollback(root, relPaths, mutate) {
  /** @type {Map<string, string | null>} */
  const snapshot = new Map();
  for (const rel of relPaths) {
    const abs = resolveInside(root, rel);
    snapshot.set(abs, (await fs.readFile(abs, 'utf8').catch(() => null)));
  }
  try {
    return await mutate();
  } catch (err) {
    for (const [abs, content] of snapshot) {
      try {
        if (content === null) await fs.rm(abs, { force: true });
        else await writeTextFileAtomic(abs, content);
      } catch {
        // best effort: keep the original error
      }
    }
    throw err;
  }
}

/**
 * Pick `name`, `name-2`, `name-3`... so an upload never overwrites an asset.
 * @param {string} dir
 * @param {string} name
 */
export async function uniqueFileName(dir, name) {
  const ext = path.extname(name);
  const stem = path.basename(name, ext) || 'asset';
  let candidate = `${stem}${ext}`;
  let i = 1;
  while (await exists(path.join(dir, candidate))) {
    i += 1;
    candidate = `${stem}-${i}${ext}`;
  }
  return candidate;
}
