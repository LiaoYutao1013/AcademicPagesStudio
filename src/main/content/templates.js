/**
 * Content-type registry.
 *
 * Every field here mirrors something the repository's own layouts read:
 * `_layouts/single.html` (post/page), `_layouts/talk.html`,
 * `_includes/archive-single.html` (venue/citation/paperurl/slidesurl/bibtexurl)
 * and `_config.yml` → `defaults:` (layout, author_profile, read_time, ...).
 * Fields that this fork does not read are deliberately absent.
 */

import { defaultsFor } from '../config/siteConfig.js';

/**
 * @typedef {object} FieldSpec
 * @property {string} key dotted path for nested keys (`header.teaser`)
 * @property {string} label
 * @property {'text'|'textarea'|'date'|'list'|'select'|'boolean'|'url'} type
 * @property {boolean} [required]
 * @property {string} [help]
 * @property {string} [placeholder]
 * @property {Array<{value: string, label: string}>} [options]
 */

/**
 * @typedef {object} TypeSpec
 * @property {string} id
 * @property {string} label
 * @property {string} dir
 * @property {string | null} collection
 * @property {boolean} datePrefix
 * @property {boolean} draftable
 * @property {FieldSpec[]} fields
 */

/** @type {Record<string, TypeSpec>} */
export const TYPE_SPECS = {
  post: {
    id: 'post',
    label: '博客文章 / 日志',
    dir: '_posts',
    collection: null,
    defaultsType: 'posts',
    datePrefix: true,
    draftable: true,
    fields: [
      { key: 'title', label: '标题', type: 'text', required: true, placeholder: '文章标题' },
      { key: 'date', label: '日期', type: 'date', required: true, help: '同时决定文件名前缀 YYYY-MM-DD-' },
      { key: 'categories', label: '分类', type: 'list', help: '用于 /categories/<分类>/ 归档，可留空' },
      { key: 'tags', label: '标签', type: 'list' },
      { key: 'excerpt', label: '摘要', type: 'textarea', help: '列表页摘要；留空时 Jekyll 取正文首段' },
      { key: 'header.teaser', label: '缩略图', type: 'text', placeholder: 'teaser.jpg', help: 'images/ 下的文件名或完整 URL' },
      { key: 'header.overlay_image', label: '头图', type: 'text', placeholder: 'header.jpg' },
      { key: 'header.overlay_filter', label: '头图遮罩', type: 'text', placeholder: '0.5', help: '0–1 的透明度' },
      { key: 'header.caption', label: '图片说明', type: 'text' },
      { key: 'last_modified_at', label: '最后修改', type: 'date' },
    ],
  },

  page: {
    id: 'page',
    label: '独立页面',
    dir: '_pages',
    collection: null,
    defaultsType: 'pages',
    datePrefix: false,
    draftable: false,
    fields: [
      { key: 'title', label: '标题', type: 'text', required: true },
      { key: 'permalink', label: '固定链接', type: 'text', required: true, placeholder: '/about/' },
      { key: 'layout', label: '布局', type: 'select', options: [
        { value: 'single', label: 'single — 普通内容页' },
        { value: 'archive', label: 'archive — 列表/归档页' },
        { value: 'splash', label: 'splash — 无侧边栏落地页' },
        { value: 'default', label: 'default — 最小布局' },
      ] },
      { key: 'author_profile', label: '显示作者侧栏', type: 'boolean' },
      { key: 'sitemap', label: '纳入 sitemap', type: 'boolean' },
      { key: 'redirect_from', label: '旧链接重定向', type: 'list', help: 'jekyll-redirect-from：源路径列表' },
      { key: 'excerpt', label: '摘要', type: 'textarea' },
    ],
  },

  publication: {
    id: 'publication',
    label: '出版物',
    dir: '_publications',
    collection: 'publications',
    defaultsType: 'publications',
    datePrefix: true,
    draftable: false,
    fields: [
      { key: 'title', label: '论文标题', type: 'text', required: true },
      { key: 'date', label: '日期', type: 'date', required: true },
      { key: 'venue', label: '发表期刊/会议', type: 'text', required: true, placeholder: 'Journal of ...' },
      { key: 'category', label: '分类', type: 'select', options: [] },
      { key: 'excerpt', label: '摘要', type: 'textarea' },
      { key: 'citation', label: '引用文本', type: 'textarea', help: 'archive-single.html 会渲染 "Recommended citation"' },
      { key: 'paperurl', label: '论文链接', type: 'url', placeholder: '/files/paper.pdf' },
      { key: 'slidesurl', label: '幻灯片链接', type: 'url' },
      { key: 'bibtexurl', label: 'BibTeX 链接', type: 'url' },
      { key: 'header.teaser', label: '缩略图', type: 'text' },
    ],
  },

  talk: {
    id: 'talk',
    label: '报告 / 演讲',
    dir: '_talks',
    collection: 'talks',
    defaultsType: 'talks',
    datePrefix: true,
    draftable: false,
    fields: [
      { key: 'title', label: '报告标题', type: 'text', required: true },
      { key: 'date', label: '日期', type: 'date', required: true },
      { key: 'type', label: '类型', type: 'text', placeholder: 'Seminar Presentation & Discussion', help: 'talks 列表显示为 "类型, 地点, 会场"' },
      { key: 'talk_type', label: '详情页副标题类型', type: 'text', help: '本仓库 _layouts/talk.html 用 talk_type 渲染 "类型 at 会场, 城市"；留空则详情页不显示该行。' },
      { key: 'venue', label: '会场 / 单位', type: 'text', placeholder: 'South China University of Technology (SCUT)' },
      { key: 'location', label: '城市', type: 'text', placeholder: 'Guangzhou, China' },
      { key: 'excerpt', label: '摘要', type: 'textarea' },
      { key: 'header.teaser', label: '缩略图', type: 'text' },
    ],
  },

  teaching: {
    id: 'teaching',
    label: '教学',
    dir: '_teaching',
    collection: 'teaching',
    defaultsType: 'teaching',
    datePrefix: true,
    draftable: false,
    fields: [
      { key: 'title', label: '课程标题', type: 'text', required: true },
      { key: 'date', label: '日期', type: 'date', required: true },
      { key: 'type', label: '类型', type: 'text', placeholder: 'Course / Guest lecture' },
      { key: 'venue', label: '单位', type: 'text' },
      { key: 'location', label: '地点', type: 'text' },
      { key: 'excerpt', label: '摘要', type: 'textarea' },
    ],
  },

  portfolio: {
    id: 'portfolio',
    label: '作品集条目',
    dir: '_portfolio',
    collection: 'portfolio',
    defaultsType: 'portfolio',
    datePrefix: true,
    draftable: false,
    fields: [
      { key: 'title', label: '标题', type: 'text', required: true },
      { key: 'date', label: '日期', type: 'date', required: true },
      { key: 'excerpt', label: '摘要', type: 'textarea' },
      { key: 'header.teaser', label: '缩略图', type: 'text' },
    ],
  },
};

/**
 * Build the generic spec used for user-created collections.
 * @param {string} label
 * @param {string} title
 * @param {Record<string, any>} config
 * @returns {TypeSpec}
 */
function genericCollectionSpec(label, title, config) {
  const defaults = defaultsFor(config.defaults ?? [], { type: label });
  const layout = defaults.layout === 'talk' ? 'talk' : 'single';
  return {
    id: `collection:${label}`,
    label: title || label,
    dir: `_${label}`,
    collection: label,
    defaultsType: label,
    datePrefix: true,
    draftable: false,
    fields: [
      { key: 'title', label: '标题', type: 'text', required: true },
      { key: 'date', label: '日期', type: 'date', required: true },
      { key: 'excerpt', label: '摘要', type: 'textarea' },
      { key: 'header.teaser', label: '缩略图', type: 'text' },
      ...(layout === 'talk'
        ? /** @type {FieldSpec[]} */ ([
            { key: 'type', label: '类型', type: 'text' },
            { key: 'venue', label: '会场 / 单位', type: 'text' },
            { key: 'location', label: '城市', type: 'text' },
          ])
        : []),
    ],
  };
}

/**
 * All types available for this repository, including its real collections.
 * @param {Record<string, any>} config
 * @returns {Array<{id: string, label: string, dir: string, draftable: boolean}>}
 */
export function listContentTypes(config) {
  const out = [
    { id: 'post', label: TYPE_SPECS.post.label, dir: '_posts', draftable: true, datePrefix: true, collection: null },
    { id: 'page', label: TYPE_SPECS.page.label, dir: '_pages', draftable: false, datePrefix: false, collection: null },
  ];

  const known = new Set(['publications', 'talks', 'teaching', 'portfolio']);
  const collections = Array.isArray(config.collections) ? config.collections : [];
  for (const collection of collections) {
    if (!collection.output) continue;
    if (known.has(collection.label)) {
      const spec = TYPE_SPECS[collection.label.replace(/s$/, '')] ?? TYPE_SPECS.portfolio;
      out.push({
        id: spec.id,
        label: spec.label,
        dir: spec.dir,
        draftable: false,
        datePrefix: spec.datePrefix,
        collection: spec.collection,
      });
      continue;
    }
    const label = collection.label;
    out.push({
      id: `collection:${label}`,
      label: label.charAt(0).toUpperCase() + label.slice(1),
      dir: `_${label}`,
      draftable: false,
      datePrefix: true,
      collection: label,
    });
  }

  // A collection present on disk but missing from _config.yml is a config
  // error the user should fix in _config.yml, so we do not invent a type for it.
  return out;
}

/**
 * Resolve a type id to its spec, filled with repository-specific options.
 * @param {Record<string, any>} config
 * @param {string} typeId
 * @returns {TypeSpec}
 */
export function resolveTypeSpec(config, typeId) {
  if (typeId && typeId.startsWith('collection:')) {
    const label = typeId.slice('collection:'.length);
    const display = config.collections?.find((c) => c.label === label);
    return genericCollectionSpec(label, display ? label : label, config);
  }
  const spec = TYPE_SPECS[typeId];
  if (!spec) {
    throw new Error(`未知内容类型: ${typeId}`);
  }
  const fields = spec.fields.map((field) => {
    if (spec.id !== 'publication' || field.key !== 'category') return field;
    return {
      ...field,
      options: (config.publicationCategories ?? []).map((c) => ({ value: c.key, label: `${c.title} (${c.key})` })),
    };
  });
  return { ...spec, fields };
}

/**
 * Front matter inherited from `_config.yml` → `defaults:` for this type.
 * These are written into the file so the result is self-describing even if
 * defaults change later, and shown read-only in the form.
 *
 * @param {Record<string, any>} config
 * @param {TypeSpec} spec
 */
export function inheritedDefaults(config, spec) {
  const type = spec.defaultsType ?? spec.collection;
  if (!type) return {};
  return defaultsFor(config.defaults ?? [], { type });
}

/**
 * File name for a document, relative to the content directory.
 *
 * @param {TypeSpec} spec
 * @param {{ slug: string, date: string, draft?: boolean }} input
 */
export function fileNameFor(spec, input) {
  const slug = input.slug || 'untitled';
  if (input.draft) return `${slug}.md`;
  if (spec.datePrefix) {
    const date = (input.date || '').slice(0, 10);
    return date ? `${date}-${slug}.md` : `${slug}.md`;
  }
  return `${slug}.md`;
}

/**
 * Directory + file name for a document.
 * @param {TypeSpec} spec
 * @param {{ slug: string, date: string, draft?: boolean }} input
 */
export function relativePathFor(spec, input) {
  const dir = input.draft ? '_drafts' : spec.dir;
  return `${dir}/${fileNameFor(spec, input)}`;
}

/**
 * Collection documents get an explicit `permalink` so URLs stay stable even
 * if the file is renamed later (matches the style of `_talks/*.md` here).
 *
 * @param {TypeSpec} spec
 * @param {{ slug: string, date: string }} input
 */
export function computedFrontMatter(spec, input) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!spec.collection) return out;
  out.collection = spec.collection;
  const stem = spec.datePrefix && input.date
    ? `${String(input.date).slice(0, 10)}-${input.slug}`
    : input.slug;
  out.permalink = `/${spec.collection}/${stem}/`;
  return out;
}

/**
 * Set of keys the form owns (so untouched user keys can be preserved).
 * @param {TypeSpec} spec
 * @returns {string[]}
 */
export function managedKeys(spec) {
  return [...spec.fields.map((f) => f.key), 'collection', 'permalink'];
}
