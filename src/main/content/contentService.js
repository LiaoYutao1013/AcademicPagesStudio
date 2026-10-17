/**
 * Document service: list / read / create / save / rename / publish-draft.
 *
 * Everything is repository-relative POSIX paths so the same document is
 * addressable from the renderer, from git and from Jekyll.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { AppError, codes } from '../util/errors.js';
import {
  exists,
  readTextFile,
  resolveInside,
  statOrNull,
  writeTextFileAtomic,
} from '../util/fsSafe.js';
import { slugify, todayISO } from '../util/text.js';
import { defaultsFor, parseYaml } from '../config/siteConfig.js';
import {
  buildFrontMatter,
  extraKeys,
  pruneEmpty,
  serializeDocument,
  splitDocument,
} from './frontmatter.js';
import {
  computedFrontMatter,
  managedKeys,
  relativePathFor,
  resolveTypeSpec,
} from './templates.js';

export const DRAFT_DIR = '_drafts';
const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.mkd', '.html', '.htm']);
const LIST_READ_LIMIT = 256 * 1024;

/** Known collection label → type id. */
const COLLECTION_TO_TYPE = {
  publications: 'publication',
  talks: 'talk',
  teaching: 'teaching',
  portfolio: 'portfolio',
};

/**
 * Which content type does a repository path belong to?
 * @param {Record<string, any>} config
 * @param {string} relPath
 * @returns {string | null}
 */
export function detectTypeId(config, relPath) {
  const posix = String(relPath).split(path.sep).join('/');
  if (posix.startsWith('_posts/')) return 'post';
  if (posix.startsWith(`${DRAFT_DIR}/`)) return 'post';
  if (posix.startsWith('_pages/')) return 'page';

  const match = /^_([A-Za-z0-9_-]+)\//.exec(posix);
  if (!match) return null;
  const label = match[1];
  const collection = (config.collections ?? []).find((c) => c.label === label);
  if (!collection) return null;
  return COLLECTION_TO_TYPE[label] ?? `collection:${label}`;
}

/** Flatten `header: {}` into `header.teaser` keys for the form. */
export function flattenData(data) {
  /** @type {Record<string, unknown>} */
  const flat = {};
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && key === 'header') {
      for (const [childKey, childValue] of Object.entries(value)) flat[`header.${childKey}`] = childValue;
      continue;
    }
    flat[key] = value;
  }
  return flat;
}

/** @param {unknown} value */
function asString(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

/**
 * Build metadata from a parsed document.
 * @param {string} relPath
 * @param {ReturnType<typeof splitDocument>} parts
 * @param {import('node:fs').Stats} stat
 * @param {Record<string, any>} config
 */
function toMeta(relPath, parts, stat, config) {
  const data = parts.data ?? {};
  const base = path.posix.basename(relPath, path.posix.extname(relPath));
  const stem = base.replace(/^\d{4}-\d{2}-\d{2}-/, '');
  return {
    path: relPath,
    typeId: detectTypeId(config, relPath),
    collection: asString(data.collection) || null,
    draft: relPath.startsWith(`${DRAFT_DIR}/`),
    title: asString(data.title) || stem,
    date: asString(data.date) || (/^\d{4}-\d{2}-\d{2}/.test(base) ? base.slice(0, 10) : ''),
    slug: stem,
    permalink: asString(data.permalink) || null,
    categories: Array.isArray(data.categories) ? data.categories.map(String) : [],
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    frontMatterError: parts.error,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
  };
}

/**
 * List documents in one content directory (or every content directory).
 *
 * @param {string} root
 * @param {{ typeId?: string, config: Record<string, any> }} options
 */
export async function listDocuments(root, options) {
  const config = options.config;
  const typeSpec = options.typeId ? resolveTypeSpec(config, options.typeId) : null;
  const dirs = [];

  if (typeSpec) {
    dirs.push(typeSpec.dir);
    if (typeSpec.draftable) dirs.push(DRAFT_DIR);
  } else {
    dirs.push('_posts', DRAFT_DIR, '_pages');
    for (const collection of config.collections ?? []) {
      if (collection.output) dirs.push(`_${collection.label}`);
    }
  }

  /** @type {any[]} */
  const docs = [];
  for (const dir of [...new Set(dirs)]) {
    const absDir = path.join(path.resolve(root), dir);
    let entries;
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!TEXT_EXTENSIONS.has(ext)) continue;

      const relPath = `${dir}/${entry.name}`;
      try {
        const abs = resolveInside(root, relPath);
        const stat = await fs.stat(abs);
        const raw = stat.size <= LIST_READ_LIMIT ? await fs.readFile(abs, 'utf8') : '';
        const parts = raw ? splitDocument(raw) : { data: {}, body: '', error: null, hasFrontMatter: false };
        docs.push(toMeta(relPath, /** @type {any} */ (parts), stat, config));
      } catch {
        // unreadable file: skip rather than fail the whole list
      }
    }
  }

  docs.sort((a, b) => {
    if (a.date !== b.date) return String(b.date).localeCompare(String(a.date));
    return a.title.localeCompare(b.title, 'zh-CN');
  });
  return docs;
}

/**
 * Read a document with its parsed front matter and body.
 * @param {string} root
 * @param {string} relPath
 * @param {Record<string, any>} config
 */
export async function readDocument(root, relPath, config) {
  const abs = resolveInside(root, relPath);
  const stat = await statOrNull(abs);
  if (!stat) throw new AppError(codes.FILE_NOT_FOUND, `文件不存在: ${relPath}`, { path: relPath });
  const raw = await readTextFile(abs);
  const parts = splitDocument(raw);
  const meta = toMeta(relPath.split(path.sep).join('/'), parts, stat, config);

  return {
    ...meta,
    raw,
    frontMatterText: parts.frontMatterText,
    data: parts.data,
    flatData: flattenData(parts.data),
    body: parts.body,
    hasFrontMatter: parts.hasFrontMatter,
  };
}

/**
 * Unique target path: `name-2.md`, `name-3.md`, ...
 * @param {string} root
 * @param {string} relPath
 */
async function ensureUniquePath(root, relPath) {
  const abs = resolveInside(root, relPath);
  if (!(await exists(abs))) return relPath;
  const dir = path.posix.dirname(relPath);
  const ext = path.posix.extname(relPath);
  const stem = path.posix.basename(relPath, ext);
  for (let i = 2; i < 500; i += 1) {
    const candidate = `${dir}/${stem}-${i}${ext}`;
    if (!(await exists(resolveInside(root, candidate)))) return candidate;
  }
  throw new AppError(codes.FILE_CONFLICT, `无法为 ${relPath} 生成不冲突的文件名`, { path: relPath });
}

/**
 * Create a document.
 *
 * @param {string} root
 * @param {{
 *   typeId: string,
 *   title: string,
 *   slug?: string,
 *   date?: string,
 *   draft?: boolean,
 *   values?: Record<string, unknown>,
 *   body?: string,
 *   config: Record<string, any>,
 * }} input
 */
export async function createDocument(root, input) {
  const spec = resolveTypeSpec(input.config, input.typeId);
  const date = input.date || todayISO();
  const slug = slugify(input.slug || input.title || '') || `note-${Date.now().toString(36)}`;
  const draft = Boolean(input.draft && spec.draftable);

  let relPath = relativePathFor(spec, { slug, date, draft });
  relPath = await ensureUniquePath(root, relPath);

  const inherited = inheritedDefaultsFor(input.config, spec);
  const values = { ...(input.values ?? {}), title: input.title, date };
  // Pages need a permalink; derive one from the slug when the form left it out.
  if (spec.id === 'page' && !values.permalink) values.permalink = `/${slug}/`;
  const computed = draft ? {} : computedFrontMatter(spec, { slug, date });

  const data = buildFrontMatter({
    inherited,
    ordered: spec.fields,
    values,
    extra: {},
    computed,
  });

  const content = serializeDocument(data, input.body ?? '', { eol: '\n' });
  const abs = resolveInside(root, relPath);
  await writeTextFileAtomic(abs, content);
  const stat = await fs.stat(abs);

  return { ...toMeta(relPath, splitDocument(content), stat, input.config), data };
}

/** Defaults for the type's collection scope, keyed by `defaultsType`. */
function inheritedDefaultsFor(config, spec) {
  const type = spec.defaultsType ?? spec.collection;
  if (!type) return {};
  return defaultsFor(config.defaults ?? [], { type });
}

/**
 * Save a document.
 *
 * Strategy:
 *   - if `frontMatterText` is supplied, it is authoritative (raw YAML editing);
 *   - otherwise the form values are re-assembled in template order, with
 *     `_config.yml` defaults injected and unknown user keys preserved;
 *   - `expectedMtimeMs` guards against overwriting an external edit.
 *
 * @param {string} root
 * @param {{
 *   path: string,
 *   values?: Record<string, unknown>,
 *   body: string,
 *   frontMatterText?: string,
 *   expectedMtimeMs?: number,
 *   config: Record<string, any>,
 * }} input
 */
export async function saveDocument(root, input) {
  const relPath = input.path.split(path.sep).join('/');
  const abs = resolveInside(root, relPath);
  const stat = await statOrNull(abs);
  if (!stat) throw new AppError(codes.FILE_NOT_FOUND, `文件不存在: ${relPath}`, { path: relPath });
  if (input.expectedMtimeMs && Math.abs(stat.mtimeMs - input.expectedMtimeMs) > 2) {
    throw new AppError(codes.FILE_CONFLICT, '文件已被其他程序修改，请重新打开后再保存', {
      path: relPath,
      diskMtimeMs: stat.mtimeMs,
      expectedMtimeMs: input.expectedMtimeMs,
    });
  }

  const current = splitDocument(await readTextFile(abs));
  const typeId = detectTypeId(input.config, relPath);
  const spec = typeId ? resolveTypeSpec(input.config, typeId) : null;

  let data;
  if (input.frontMatterText !== undefined) {
    const parsed = parseYaml(input.frontMatterText, relPath);
    const obj = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    data = pruneEmpty(obj);
  } else {
    const extra = spec ? extraKeys(current.data, managedKeys(spec)) : current.data;
    const computed = spec && spec.collection
      ? {
          collection: current.data.collection ?? spec.collection,
          permalink: current.data.permalink ?? computedFrontMatter(spec, {
            slug: path.posix.basename(relPath, path.posix.extname(relPath)).replace(/^\d{4}-\d{2}-\d{2}-/, ''),
            date: String(current.data.date ?? '').slice(0, 10),
          }).permalink,
        }
      : {};
    data = buildFrontMatter({
      inherited: spec ? inheritedDefaultsFor(input.config, spec) : {},
      ordered: spec ? spec.fields : [],
      values: input.values ?? {},
      extra,
      computed,
    });
  }

  const content = serializeDocument(data, input.body, { eol: current.eol });
  await writeTextFileAtomic(abs, content);
  const nextStat = await fs.stat(abs);
  return { ...toMeta(relPath, splitDocument(content), nextStat, input.config), data };
}

/**
 * Rename a document (slug and/or date). The date prefix and the YAML `date`
 * are kept in sync for dated collections and posts.
 *
 * @param {string} root
 * @param {{
 *   path: string,
 *   slug?: string,
 *   date?: string,
 *   config: Record<string, any>,
 * }} input
 */
export async function renameDocument(root, input) {
  const relPath = input.path.split(path.sep).join('/');
  const abs = resolveInside(root, relPath);
  const stat = await statOrNull(abs);
  if (!stat) throw new AppError(codes.FILE_NOT_FOUND, `文件不存在: ${relPath}`, { path: relPath });

  const typeId = detectTypeId(input.config, relPath);
  const spec = typeId ? resolveTypeSpec(input.config, typeId) : null;
  if (!spec) throw new AppError(codes.VALIDATION, '无法识别该文件的类型，不能重命名', { path: relPath });

  const raw = await readTextFile(abs);
  const parts = splitDocument(raw);
  const base = path.posix.basename(relPath, path.posix.extname(relPath));
  const currentSlug = base.replace(/^\d{4}-\d{2}-\d{2}-/, '');
  const slug = slugify(input.slug || currentSlug) || currentSlug;
  const date = input.date || asString(parts.data.date) || todayISO();

  const dir = path.posix.dirname(relPath);
  const draft = relPath.startsWith(`${DRAFT_DIR}/`);
  let name = draft ? `${slug}.md` : `${date.slice(0, 10)}-${slug}.md`;
  if (!spec.datePrefix && !draft) name = `${slug}.md`;

  let nextRel = `${dir}/${name}`;
  if (nextRel === relPath) return readDocument(root, relPath, input.config);

  if (await exists(resolveInside(root, nextRel))) {
    throw new AppError(codes.FILE_CONFLICT, `目标文件已存在: ${nextRel}`, { path: nextRel });
  }

  if (spec.datePrefix && !draft) {
    const data = { ...parts.data, date: date.slice(0, 10) };
    const content = serializeDocument(data, parts.body, { eol: parts.eol });
    await writeTextFileAtomic(resolveInside(root, nextRel), content);
    await fs.rm(abs);
  } else {
    await fs.rename(abs, resolveInside(root, nextRel));
  }

  return readDocument(root, nextRel, input.config);
}

/**
 * Move a draft from `_drafts/` to `_posts/`, adding the date prefix and
 * filling `date` if it was missing.
 *
 * @param {string} root
 * @param {{ path: string, date?: string, slug?: string, config: Record<string, any> }} input
 */
export async function publishDraft(root, input) {
  const relPath = input.path.split(path.sep).join('/');
  if (!relPath.startsWith(`${DRAFT_DIR}/`)) {
    throw new AppError(codes.VALIDATION, '只有 _drafts/ 下的草稿可以发布', { path: relPath });
  }
  const abs = resolveInside(root, relPath);
  if (!(await exists(abs))) throw new AppError(codes.FILE_NOT_FOUND, `草稿不存在: ${relPath}`, { path: relPath });

  const raw = await readTextFile(abs);
  const parts = splitDocument(raw);
  const base = path.posix.basename(relPath, path.posix.extname(relPath));
  const slug = slugify(input.slug || base) || base;
  const date = (input.date || asString(parts.data.date) || todayISO()).slice(0, 10);

  let target = `_posts/${date}-${slug}.md`;
  target = await ensureUniquePath(root, target);

  const data = { ...parts.data, date };
  const content = serializeDocument(data, parts.body, { eol: parts.eol });
  await writeTextFileAtomic(resolveInside(root, target), content);
  await fs.rm(abs);

  return readDocument(root, target, input.config);
}

/**
 * Delete a document. The renderer asks for confirmation first; when Electron's
 * `shell.trashItem` is available the file goes to the OS trash instead of
 * being unlinked.
 *
 * @param {string} root
 * @param {string} relPath
 * @param {(abs: string) => Promise<void>} [trashItem]
 */
export async function deleteDocument(root, relPath, trashItem) {
  const abs = resolveInside(root, relPath);
  if (!(await exists(abs))) throw new AppError(codes.FILE_NOT_FOUND, `文件不存在: ${relPath}`, { path: relPath });
  if (trashItem) {
    await trashItem(abs);
    return { ok: true, trashed: true, path: relPath };
  }
  await fs.rm(abs);
  return { ok: true, trashed: false, path: relPath };
}

/** Suggest a non-colliding slug for a new document. */
export async function suggestPath(root, { typeId, title, date, draft, config }) {
  const spec = resolveTypeSpec(config, typeId);
  const slug = slugify(title);
  const relPath = relativePathFor(spec, { slug, date: date || todayISO(), draft });
  return { slug, path: relPath, available: !(await exists(resolveInside(root, relPath))) };
}
