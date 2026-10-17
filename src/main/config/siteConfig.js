/**
 * Site configuration model: reads `_config.yml`, validates that a directory
 * really is an Academic Pages repository, and exposes the parts of the config
 * the UI needs (author, collections, defaults, publication categories).
 *
 * Reads use js-yaml (fast, battle-tested). Writes never use js-yaml — see
 * `yamlText.js` for why.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';

import { AppError, codes } from '../util/errors.js';
import { exists, readTextFile, resolveInside, statOrNull } from '../util/fsSafe.js';

export const CONFIG_FILE = '_config.yml';
export const NAVIGATION_FILE = '_data/navigation.yml';

/**
 * @typedef {object} CollectionInfo
 * @property {string} label
 * @property {boolean} output
 * @property {string | null} permalink
 */

/**
 * @typedef {object} DefaultsEntry
 * @property {{ path?: string, type?: string }} scope
 * @property {Record<string, unknown>} values
 */

/**
 * @typedef {object} SiteConfig
 * @property {string} configPath
 * @property {string} raw
 * @property {Record<string, any>} data
 * @property {string} title
 * @property {string} description
 * @property {string} url
 * @property {string} baseurl
 * @property {string} locale
 * @property {string} repository
 * @property {Record<string, any>} author
 * @property {CollectionInfo[]} collections
 * @property {DefaultsEntry[]} defaults
 * @property {Array<{ key: string, title: string }>} publicationCategories
 */

/** Parse YAML, mapping library errors onto a stable app error. */
export function parseYaml(text, file = CONFIG_FILE) {
  try {
    const data = yaml.load(text, { json: false });
    return data ?? {};
  } catch (err) {
    const mark = err && typeof err === 'object' && 'mark' in err ? err.mark : null;
    throw new AppError(codes.YAML_INVALID, `YAML 解析失败: ${err.message}`, {
      file,
      line: mark ? mark.line + 1 : null,
      column: mark ? mark.column + 1 : null,
    });
  }
}

/** Normalise the many shapes YAML can produce into a flat collection list. */
function normaliseCollections(data) {
  /** @type {CollectionInfo[]} */
  const out = [];
  const raw = data && typeof data.collections === 'object' && data.collections ? data.collections : {};
  for (const [label, value] of Object.entries(raw)) {
    if (value === null || value === true) {
      out.push({ label, output: true, permalink: null });
    } else if (typeof value === 'object') {
      const v = /** @type {Record<string, unknown>} */ (value);
      out.push({
        label,
        output: v.output === true,
        permalink: typeof v.permalink === 'string' ? v.permalink : null,
      });
    }
  }
  return out;
}

/** Normalise `defaults:` into a list of scope/values pairs. */
function normaliseDefaults(data) {
  const raw = Array.isArray(data?.defaults) ? data.defaults : [];
  /** @type {DefaultsEntry[]} */
  const out = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const scope = entry.scope && typeof entry.scope === 'object' ? entry.scope : {};
    const values = entry.values && typeof entry.values === 'object' ? entry.values : {};
    out.push({ scope, values });
  }
  return out;
}

/**
 * Jekyll's defaults matching: every entry whose `scope.path` is a prefix of the
 * document path and whose `scope.type` matches (or is absent) applies, in
 * order, later entries winning. We only need the type + empty-path case for
 * the form prefill, but implement the general rule to stay honest.
 *
 * @param {DefaultsEntry[]} defaults
 * @param {{ type: string, path?: string }} target
 * @returns {Record<string, unknown>}
 */
export function defaultsFor(defaults, target) {
  /** @type {Record<string, unknown>} */
  const merged = {};
  for (const entry of defaults) {
    const scopeType = entry.scope.type;
    if (scopeType && scopeType !== target.type) continue;
    const scopePath = entry.scope.path ?? '';
    if (scopePath && !(target.path ?? '').startsWith(scopePath)) continue;
    Object.assign(merged, entry.values);
  }
  return merged;
}

/**
 * Validate the workspace root. Academic Pages is a Jekyll site, so the two
 * non-negotiable markers are `_config.yml` and a `_layouts`/`_includes` pair.
 *
 * @param {string} root
 * @returns {Promise<{ root: string, configPath: string, hasNavigation: boolean, hasDrafts: boolean }>}
 */
export async function assertRepository(root) {
  const abs = path.resolve(String(root || ''));
  const stat = await statOrNull(abs);
  if (!stat || !stat.isDirectory()) {
    throw new AppError(codes.REPO_NOT_FOUND, `仓库目录不存在: ${abs}`, { root: abs });
  }
  const configPath = path.join(abs, CONFIG_FILE);
  if (!(await exists(configPath))) {
    throw new AppError(codes.REPO_INVALID, '该目录缺少 _config.yml，不是 Jekyll/Academic Pages 仓库', {
      root: abs,
    });
  }
  const markers = await Promise.all(
    ['_layouts', '_includes', '_pages'].map((dir) => exists(path.join(abs, dir))),
  );
  if (!markers.some(Boolean)) {
    throw new AppError(codes.REPO_INVALID, '该目录缺少 Academic Pages 结构（_layouts/_includes/_pages）', {
      root: abs,
    });
  }
  return {
    root: abs,
    configPath,
    hasNavigation: await exists(path.join(abs, NAVIGATION_FILE)),
    hasDrafts: await exists(path.join(abs, '_drafts')),
  };
}

/**
 * @param {string} root
 * @returns {Promise<SiteConfig>}
 */
export async function readSiteConfig(root) {
  const { configPath } = await assertRepository(root);
  const raw = await readTextFile(configPath);
  const data = parseYaml(raw, CONFIG_FILE);

  const author = data.author && typeof data.author === 'object' ? data.author : {};
  const pubCats = data.publication_category && typeof data.publication_category === 'object'
    ? Object.entries(data.publication_category).map(([key, value]) => ({
        key,
        title: value && typeof value === 'object' && 'title' in value ? String(value.title) : key,
      }))
    : [];

  return {
    configPath,
    raw,
    data,
    title: typeof data.title === 'string' ? data.title : '',
    description: typeof data.description === 'string' ? data.description : '',
    url: typeof data.url === 'string' ? data.url : '',
    baseurl: typeof data.baseurl === 'string' ? data.baseurl : '',
    locale: typeof data.locale === 'string' ? data.locale : 'en',
    repository: typeof data.repository === 'string' ? data.repository : '',
    author,
    collections: normaliseCollections(data),
    defaults: normaliseDefaults(data),
    publicationCategories: pubCats,
  };
}

/**
 * Read `_data/navigation.yml` raw text (writing goes through navigationService).
 * @param {string} root
 */
export async function readNavigationText(root) {
  const file = resolveInside(root, NAVIGATION_FILE);
  if (!(await exists(file))) {
    throw new AppError(codes.FILE_NOT_FOUND, '缺少 _data/navigation.yml', { file: NAVIGATION_FILE });
  }
  return readTextFile(file);
}

/** Suggested content directories, derived from the actual repository. */
export async function detectContentDirs(root) {
  const candidates = ['_posts', '_drafts', '_pages', '_publications', '_talks', '_teaching', '_portfolio'];
  /** @type {Record<string, boolean>} */
  const out = {};
  for (const dir of candidates) out[dir] = await exists(path.join(root, dir));
  return out;
}

/** Read `_data/ui-text.yml` label for a locale, if present (small nicety). */
export async function readUiText(root, locale) {
  const file = path.join(root, '_data', 'ui-text.yml');
  if (!(await exists(file))) return {};
  try {
    const raw = await fs.readFile(file, 'utf8');
    const data = yaml.load(raw) ?? {};
    const block = locale && data[locale] ? data[locale] : {};
    return typeof block === 'object' ? block : {};
  } catch {
    return {};
  }
}
