/**
 * Author block (`_config.yml` → `author:`).
 *
 * Field list is taken 1:1 from `_includes/author-profile.html` in this
 * repository, including which fields are rendered as a *username* (the
 * template concatenates `https://site/{{ value }}`) versus a full URL.
 * Getting this wrong silently produces broken social links, so the field
 * model records it and the validator warns when a username field contains a
 * URL.
 */

import { AppError, codes } from '../util/errors.js';
import { setMappingValues } from './yamlText.js';
import { parseYaml } from './siteConfig.js';

/**
 * @typedef {object} AuthorField
 * @property {string} key
 * @property {string} label
 * @property {'text'|'textarea'|'url'|'email'|'username'|'file'} kind
 * @property {string} group
 * @property {string} [help]
 */

/** @type {AuthorField[]} */
export const AUTHOR_FIELDS = [
  { key: 'avatar', label: '头像文件名', kind: 'file', group: '基本信息', help: '放在 images/ 下的文件名；模板会自动拼 /images/。留空会渲染出无效图片。' },
  { key: 'name', label: '姓名', kind: 'text', group: '基本信息' },
  { key: 'pronouns', label: '人称代词', kind: 'text', group: '基本信息', help: '如 she/her、he/him，可留空。' },
  { key: 'bio', label: '简介', kind: 'textarea', group: '基本信息', help: '显示在头像下方，建议 1–2 句。' },
  { key: 'location', label: '所在地', kind: 'text', group: '基本信息' },
  { key: 'employer', label: '单位', kind: 'text', group: '基本信息' },
  { key: 'uri', label: '个人主页', kind: 'url', group: '基本信息', help: '完整 URL，直接作为链接 href。' },
  { key: 'email', label: '邮箱', kind: 'email', group: '基本信息' },

  { key: 'academia', label: 'Academia.edu', kind: 'url', group: '学术主页', help: '完整 URL。' },
  { key: 'arxiv', label: 'arXiv', kind: 'url', group: '学术主页', help: '完整 URL。' },
  { key: 'googlescholar', label: 'Google Scholar', kind: 'url', group: '学术主页', help: '完整 URL，通常是 scholar.google.com/citations?user=...' },
  { key: 'inspire-hep', label: 'INSPIRE-HEP', kind: 'url', group: '学术主页', help: '完整 URL。' },
  { key: 'impactstory', label: 'Impactstory', kind: 'url', group: '学术主页', help: '完整 URL。' },
  { key: 'orcid', label: 'ORCID', kind: 'url', group: '学术主页', help: '完整 URL，如 https://orcid.org/0000-0000-0000-0000' },
  { key: 'semantic', label: 'Semantic Scholar', kind: 'url', group: '学术主页', help: '完整 URL。' },
  { key: 'ssrn', label: 'SSRN', kind: 'url', group: '学术主页', help: '完整 URL。' },
  { key: 'pubmed', label: 'PubMed', kind: 'url', group: '学术主页', help: '完整 URL。' },
  { key: 'researchgate', label: 'ResearchGate', kind: 'url', group: '学术主页', help: '完整 URL。' },
  { key: 'scopus', label: 'Scopus', kind: 'url', group: '学术主页', help: '完整 URL。' },
  { key: 'zotero', label: 'Zotero', kind: 'url', group: '学术主页', help: '完整 URL。' },

  { key: 'bitbucket', label: 'Bitbucket', kind: 'username', group: '代码与作品' },
  { key: 'codepen', label: 'CodePen', kind: 'username', group: '代码与作品' },
  { key: 'dribbble', label: 'Dribbble', kind: 'username', group: '代码与作品' },
  { key: 'github', label: 'GitHub', kind: 'username', group: '代码与作品', help: '只填用户名，模板拼成 https://github.com/{{username}}' },
  { key: 'kaggle', label: 'Kaggle', kind: 'username', group: '代码与作品' },
  { key: 'stackoverflow', label: 'Stack Overflow', kind: 'username', group: '代码与作品', help: '用户 ID 或 ID/用户名。' },

  { key: 'artstation', label: 'ArtStation', kind: 'username', group: '社交媒体' },
  { key: 'bluesky', label: 'Bluesky', kind: 'username', group: '社交媒体', help: 'handle，如 name.bsky.social' },
  { key: 'facebook', label: 'Facebook', kind: 'username', group: '社交媒体' },
  { key: 'flickr', label: 'Flickr', kind: 'username', group: '社交媒体' },
  { key: 'foursquare', label: 'Foursquare', kind: 'username', group: '社交媒体' },
  { key: 'goodreads', label: 'Goodreads', kind: 'username', group: '社交媒体' },
  { key: 'google_plus', label: 'Google+', kind: 'username', group: '社交媒体', help: '已停用，保留字段以兼容模板。' },
  { key: 'keybase', label: 'Keybase', kind: 'username', group: '社交媒体' },
  { key: 'instagram', label: 'Instagram', kind: 'username', group: '社交媒体' },
  { key: 'lastfm', label: 'Last.fm', kind: 'username', group: '社交媒体' },
  { key: 'linkedin', label: 'LinkedIn', kind: 'username', group: '社交媒体' },
  { key: 'mastodon', label: 'Mastodon', kind: 'url', group: '社交媒体', help: '完整 URL，模板直接用作 href。' },
  { key: 'medium', label: 'Medium', kind: 'url', group: '社交媒体', help: '完整 URL。' },
  { key: 'pinterest', label: 'Pinterest', kind: 'username', group: '社交媒体' },
  { key: 'soundcloud', label: 'SoundCloud', kind: 'username', group: '社交媒体' },
  { key: 'steam', label: 'Steam', kind: 'username', group: '社交媒体', help: '本仓库模板拼成 steamcommunity.com/id/{{value}}，填完整 URL 会生成错误链接。' },
  { key: 'telegram', label: 'Telegram', kind: 'url', group: '社交媒体', help: '完整 URL。' },
  { key: 'tumblr', label: 'Tumblr', kind: 'username', group: '社交媒体', help: '子域名部分，模板拼成 {{value}}.tumblr.com' },
  { key: 'twitter', label: 'X (Twitter)', kind: 'username', group: '社交媒体' },
  { key: 'vine', label: 'Vine', kind: 'username', group: '社交媒体', help: '已停用，保留字段。' },
  { key: 'weibo', label: '微博', kind: 'username', group: '社交媒体' },
  { key: 'wikipedia', label: 'Wikipedia', kind: 'username', group: '社交媒体', help: '用户名，模板拼成 User:{{value}}' },
  { key: 'xing', label: 'XING', kind: 'username', group: '社交媒体' },
  { key: 'youtube', label: 'YouTube', kind: 'username', group: '社交媒体', help: '频道 handle，模板拼成 @{{value}}' },
  { key: 'zhihu', label: '知乎', kind: 'username', group: '社交媒体', help: '本仓库模板拼成 zhihu.com/people/{{value}}，用户名而非完整 URL。' },
];

export const AUTHOR_GROUPS = [...new Set(AUTHOR_FIELDS.map((f) => f.group))];
const FIELD_BY_KEY = new Map(AUTHOR_FIELDS.map((f) => [f.key, f]));

/**
 * Read the author block plus any user-defined extra keys.
 *
 * @param {string} configText
 * @returns {{ values: Record<string, string>, extras: Record<string, unknown>, rawAuthor: Record<string, unknown> }}
 */
export function readAuthor(configText) {
  const data = parseYaml(configText);
  const rawAuthor = data && typeof data.author === 'object' && data.author ? data.author : {};

  /** @type {Record<string, string>} */
  const values = {};
  for (const field of AUTHOR_FIELDS) {
    const v = rawAuthor[field.key];
    values[field.key] = v === null || v === undefined ? '' : String(v);
  }
  /** @type {Record<string, unknown>} */
  const extras = {};
  for (const [key, value] of Object.entries(rawAuthor)) {
    if (!FIELD_BY_KEY.has(key)) extras[key] = value;
  }
  return { values, extras, rawAuthor };
}

/**
 * Validate values before writing. `errors` block the save, `warnings` are
 * shown but do not block (e.g. the site already ships with a full URL in a
 * username field).
 *
 * @param {Record<string, unknown>} values
 * @returns {{ errors: Array<{key: string, message: string}>, warnings: Array<{key: string, message: string}> }}
 */
export function validateAuthor(values) {
  const errors = [];
  const warnings = [];

  const avatar = String(values.avatar ?? '').trim();
  if (avatar && !/^https?:\/\//.test(avatar) && /[\\/]/.test(avatar)) {
    errors.push({ key: 'avatar', message: '头像请只填文件名（图片会自动放入 images/），不要包含路径。' });
  }

  const email = String(values.email ?? '').trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push({ key: 'email', message: '邮箱格式不正确。' });
  }

  for (const field of AUTHOR_FIELDS) {
    const raw = values[field.key];
    if (raw === undefined || raw === null || String(raw).trim() === '') continue;
    const value = String(raw).trim();

    if (field.kind === 'url' && field.key !== 'avatar' && !/^https?:\/\//i.test(value)) {
      warnings.push({ key: field.key, message: `${field.label} 建议填写完整 URL（http:// 或 https:// 开头）。` });
    }
    if (field.kind === 'username' && /:\/\//.test(value)) {
      warnings.push({
        key: field.key,
        message: `${field.label} 在模板中按用户名拼接，填完整 URL 会生成无效链接。`,
      });
    }
    if (/[\r\n]/.test(value)) {
      errors.push({ key: field.key, message: `${field.label} 不能包含换行。` });
    }
  }

  if (!String(values.name ?? '').trim()) {
    warnings.push({ key: 'name', message: '姓名为空：侧边栏作者卡片会缺失标题。' });
  }
  if (!avatar) {
    warnings.push({ key: 'avatar', message: '头像为空：模板会渲染 <img src="/images/"> 这类无效图片。' });
  }

  return { errors, warnings };
}

/** Normalise `images/foo.jpg`, `/images/foo.jpg` → `foo.jpg`. */
export function normalizeAvatarName(input) {
  let name = String(input ?? '').trim();
  if (/^https?:\/\//i.test(name)) return name;
  name = name.replace(/^\/+/, '').replace(/^images\//, '');
  return name;
}

/**
 * Apply an author patch to `_config.yml` text. Only the listed fields change;
 * every other byte (comments, collections, defaults) is preserved.
 *
 * @param {string} configText
 * @param {Record<string, unknown>} patch
 * @returns {{ text: string, changedKeys: string[], addedKeys: string[], warnings: Array<{key: string, message: string}> }}
 */
export function updateAuthor(configText, patch) {
  const { values } = readAuthor(configText);
  /** @type {Record<string, unknown>} */
  const merged = { ...values };
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'avatar') merged.avatar = normalizeAvatarName(value);
    else merged[key] = value === undefined ? merged[key] : value;
  }

  const { errors, warnings } = validateAuthor(merged);
  if (errors.length) {
    throw new AppError(codes.VALIDATION, errors[0].message, { errors, warnings });
  }

  const clean = {};
  for (const [key, value] of Object.entries(patch)) {
    clean[key] = key === 'avatar' ? normalizeAvatarName(value) : value;
  }

  const result = setMappingValues(configText, 'author', clean);
  return { text: result.text, changedKeys: result.changedKeys, addedKeys: result.addedKeys, warnings };
}
