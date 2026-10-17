/**
 * Custom collection ("分区") creation.
 *
 * Academic Pages needs four coordinated edits to expose a new section, and
 * doing them by hand is where people break their site:
 *   1. `_config.yml` → `collections:` entry with `output: true`
 *   2. `_config.yml` → `defaults:` entry so items get `layout`/`author_profile`
 *   3. `_pages/<slug>.html` → archive page looping over `site.<label>`
 *   4. `_data/navigation.yml` → `main:` item (optional but expected)
 *
 * `planCollection` is pure and produces the exact file bodies; `preview`
 * diffs them against disk; `apply` writes them inside a rollback transaction.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { AppError, codes } from '../util/errors.js';
import { exists, readTextFile, resolveInside, withRollback, writeTextFileAtomic } from '../util/fsSafe.js';
import { slugify } from '../util/text.js';
import { appendMappingEntry, appendSequenceEntry } from './yamlText.js';
import { parseNavigation, updateNavigation } from './navigationService.js';
import { assertRepository, readNavigationText, readSiteConfig } from './siteConfig.js';

/** Labels Jekyll reserves or that would shadow a top-level directory. */
export const RESERVED_LABELS = new Set([
  'posts',
  'pages',
  'data',
  'drafts',
  'layouts',
  'includes',
  'sass',
  'assets',
  'site',
  'jekyll',
]);

/**
 * Jekyll collection labels are used as a directory name and a Liquid
 * variable, so restrict to `[a-z0-9_-]` starting with a letter.
 * @param {string} input
 */
export function normalizeLabel(input) {
  return String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/^_+/, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * @typedef {object} CollectionPlan
 * @property {string} label
 * @property {string} title
 * @property {string} permalink
 * @property {string} dir
 * @property {string} pagePath
 * @property {string} archiveUrl
 * @property {string} layout
 * @property {boolean} includeNav
 * @property {string} intro
 * @property {boolean} share
 * @property {boolean} comments
 */

/**
 * Build a plan from UI input. Pure: no filesystem access.
 *
 * @param {{
 *   label: string,
 *   title: string,
 *   layout?: 'single'|'talk',
 *   permalink?: string,
 *   includeNav?: boolean,
 *   navTitle?: string,
 *   navUrl?: string,
 *   intro?: string,
 *   share?: boolean,
 *   comments?: boolean,
 * }} input
 * @returns {CollectionPlan}
 */
export function planCollection(input) {
  const label = normalizeLabel(input.label);
  const title = String(input.title ?? '').trim();
  const permalink = String(input.permalink ?? '').trim() || '/:collection/:path/';
  const layout = input.layout === 'talk' ? 'talk' : 'single';
  const includeNav = input.includeNav !== false;
  const archiveUrl = String(input.navUrl ?? '').trim() || `/${label}/`;

  return {
    label,
    title,
    permalink,
    dir: `_${label}`,
    pagePath: `_pages/${slugify(title || label) || label}.html`,
    archiveUrl,
    layout,
    includeNav,
    intro: String(input.intro ?? '').trim(),
    share: input.share !== false,
    comments: input.comments !== false,
  };
}

/** `collections:` entry body (relative to `  <label>:`). */
export function collectionEntryLines(plan) {
  return ['output: true', `permalink: ${plan.permalink}`];
}

/** `defaults:` sequence item (relative; first line becomes `  - scope:`). */
export function defaultsItemLines(plan) {
  const lines = [
    '- scope:',
    '    path: ""',
    `    type: ${plan.label}`,
    '  values:',
    `    layout: ${plan.layout}`,
    '    author_profile: true',
  ];
  if (plan.share) lines.push('    share: true');
  if (plan.comments) lines.push('    comments: true');
  return lines;
}

/**
 * Archive page that Academic Pages renders at `/<archiveUrl>`.
 * Mirrors `_pages/publications.html` / `_pages/portfolio.html` conventions:
 * `layout: archive` + an include per item.
 *
 * @param {CollectionPlan} plan
 */
export function archivePageSource(plan) {
  const include = plan.layout === 'talk' ? 'archive-single-talk.html' : 'archive-single.html';
  const intro = plan.intro ? `\n${plan.intro}\n` : '';
  return [
    '---',
    'layout: archive',
    `title: ${JSON.stringify(plan.title)}`,
    `permalink: ${plan.archiveUrl}`,
    'author_profile: true',
    '---',
    '',
    '{% include base_path %}',
    intro,
    `{% for post in site.${plan.label} %}`,
    `  {% include ${include} %}`,
    '{% endfor %}',
    '',
  ]
    .join('\n')
    .replace(/\n{4,}/g, '\n\n\n');
}

/**
 * New `_config.yml` text: append the collection and its defaults entry.
 * Both operations are line-range appends, so every existing comment stays.
 *
 * @param {string} configText
 * @param {CollectionPlan} plan
 */
export function buildConfigText(configText, plan) {
  const withCollection = appendMappingEntry(
    configText,
    'collections',
    plan.label,
    collectionEntryLines(plan),
    { comment: `# ${plan.title}` },
  );
  return appendSequenceEntry(withCollection, 'defaults', defaultsItemLines(plan), {
    comment: `# _${plan.label}`,
  });
}

/**
 * New `_data/navigation.yml` text with the archive page appended.
 * @param {string} navText
 * @param {CollectionPlan} plan
 */
export function buildNavigationText(navText, plan) {
  const { items } = parseNavigation(navText);
  return updateNavigation(navText, [...items, { title: plan.title, url: plan.archiveUrl }]).text;
}

/**
 * Filesystem-level checks before previewing or writing.
 *
 * @param {string} root
 * @param {CollectionPlan} plan
 */
export async function checkPlan(root, plan) {
  /** @type {Array<{message: string}>} */
  const errors = [];
  /** @type {Array<{message: string}>} */
  const warnings = [];

  if (!plan.label) errors.push({ message: '集合标识不能为空（只能包含小写字母、数字、- 和 _）。' });
  if (!/^[a-z][a-z0-9_-]{0,39}$/.test(plan.label)) {
    errors.push({ message: `集合标识 "${plan.label}" 不合法：需小写字母开头，仅含 a-z 0-9 - _，最长 40 字符。` });
  }
  if (RESERVED_LABELS.has(plan.label)) errors.push({ message: `"${plan.label}" 是 Jekyll 保留标识，请换一个。` });
  if (!plan.title) errors.push({ message: '分区标题不能为空。' });
  if (!plan.permalink.includes(':collection')) {
    errors.push({ message: 'permalink 必须包含 :collection，否则集合条目会互相覆盖。' });
  }
  if (!/^\//.test(plan.archiveUrl)) errors.push({ message: '归档页 URL 必须以 / 开头。' });

  await assertRepository(root);
  const config = await readSiteConfig(root);

  if (config.collections.some((c) => c.label === plan.label)) {
    errors.push({ message: `_config.yml 的 collections 中已存在 "${plan.label}"。` });
  }
  if (await exists(resolveInside(root, plan.pagePath))) {
    errors.push({ message: `${plan.pagePath} 已存在，请修改标题或归档页文件名。` });
  }
  if (await exists(resolveInside(root, plan.dir))) {
    warnings.push({ message: `目录 ${plan.dir}/ 已存在，将直接复用。` });
  }

  if (plan.includeNav) {
    const navText = await readNavigationText(root);
    const { items } = parseNavigation(navText);
    if (items.some((item) => item.url === plan.archiveUrl)) {
      errors.push({ message: `导航栏已存在 URL 为 "${plan.archiveUrl}" 的条目。` });
    }
    if (items.some((item) => item.title === plan.title)) {
      warnings.push({ message: `导航栏已有同名条目 "${plan.title}"。` });
    }
  }

  return { errors, warnings };
}

/**
 * Render every file this plan would produce, without touching disk.
 *
 * @param {string} root
 * @param {CollectionPlan} plan
 * @returns {Promise<{
 *   errors: Array<{message: string}>,
 *   warnings: Array<{message: string}>,
 *   files: Array<{ path: string, action: 'create'|'update', before: string, after: string }>
 * }>}
 */
export async function previewCollection(root, plan) {
  const { errors, warnings } = await checkPlan(root, plan);

  const config = await readSiteConfig(root);
  const files = [];

  if (!errors.length) {
    files.push({
      path: '_config.yml',
      action: 'update',
      before: config.raw,
      after: buildConfigText(config.raw, plan),
    });
    files.push({
      path: plan.pagePath,
      action: 'create',
      before: '',
      after: archivePageSource(plan),
    });
    if (plan.includeNav) {
      const navText = await readNavigationText(root);
      files.push({
        path: '_data/navigation.yml',
        action: 'update',
        before: navText,
        after: buildNavigationText(navText, plan),
      });
    }
  }

  return { errors, warnings, files };
}

/**
 * Write a plan: config + archive page + navigation, atomically with rollback.
 *
 * @param {string} root
 * @param {CollectionPlan} plan
 */
export async function applyCollectionPlan(root, plan) {
  const { errors } = await checkPlan(root, plan);
  if (errors.length) {
    throw new AppError(codes.VALIDATION, errors[0].message, { errors });
  }

  const config = await readSiteConfig(root);
  const configAbs = resolveInside(root, '_config.yml');
  const pageAbs = resolveInside(root, plan.pagePath);
  const dirAbs = resolveInside(root, plan.dir);

  const nextConfig = buildConfigText(config.raw, plan);
  let nextNav = null;
  if (plan.includeNav) {
    const navText = await readNavigationText(root);
    nextNav = buildNavigationText(navText, plan);
  }

  const touched = ['_config.yml', plan.pagePath];
  if (nextNav !== null) touched.push('_data/navigation.yml');

  await withRollback(root, touched, async () => {
    await writeTextFileAtomic(configAbs, nextConfig);
    await writeTextFileAtomic(pageAbs, archivePageSource(plan));
    if (nextNav !== null) {
      await writeTextFileAtomic(resolveInside(root, '_data/navigation.yml'), nextNav);
    }
    await fs.mkdir(dirAbs, { recursive: true });
    const keep = path.join(dirAbs, '.gitkeep');
    if (!(await exists(keep))) await fs.writeFile(keep, '', 'utf8');
  });

  return { ok: true, paths: touched, plan };
}
