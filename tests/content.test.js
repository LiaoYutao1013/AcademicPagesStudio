import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';

import { makeTempRepo } from './helpers.js';
import {
  createDocument,
  deleteDocument,
  detectTypeId,
  listDocuments,
  publishDraft,
  readDocument,
  renameDocument,
  saveDocument,
} from '../src/main/content/contentService.js';
import { readSiteConfig } from '../src/main/config/siteConfig.js';

/** @param {string} root @param {string} rel */
async function readRaw(root, rel) {
  return fs.readFile(path.join(root, rel), 'utf8');
}

test('creates a dated post and injects _config.yml defaults', async () => {
  const { root, cleanup } = await makeTempRepo();
  try {
    const config = await readSiteConfig(root);
    const doc = await createDocument(root, {
      typeId: 'post',
      title: 'Hello World',
      date: '2025-03-04',
      values: { categories: ['Jekyll', 'Notes'], tags: ['edge case'] },
      body: '# Heading\n\nBody text.\n',
      config,
    });

    assert.equal(doc.path, '_posts/2025-03-04-hello-world.md');
    const raw = await readRaw(root, doc.path);
    assert.match(raw, /^date: 2025-03-04$/m, 'date is unquoted like the rest of the repo');
    const data = yaml.load(raw.split('---')[1]);
    assert.equal(data.layout, 'single');
    assert.equal(data.author_profile, true);
    assert.equal(data.read_time, true);
    assert.equal(data.comments, true);
    assert.equal(data.share, true);
    assert.equal(data.related, true);
    assert.deepEqual(data.categories, ['Jekyll', 'Notes']);
    assert.equal(data.collection, undefined, 'posts do not get a collection key');
    assert.match(raw, /# Heading/);
  } finally {
    await cleanup();
  }
});

test('collection documents get collection + stable permalink, and the talk layout', async () => {
  const { root, cleanup } = await makeTempRepo();
  try {
    const config = await readSiteConfig(root);
    const doc = await createDocument(root, {
      typeId: 'talk',
      title: 'The molecules that changed the world',
      date: '2025-11-06',
      values: { type: 'Seminar', venue: 'SCUT', location: 'Guangzhou, China' },
      body: '### Summary\n',
      config,
    });

    assert.equal(doc.path, '_talks/2025-11-06-the-molecules-that-changed-the-world.md');
    const data = yaml.load((await readRaw(root, doc.path)).split('---')[1]);
    assert.equal(data.collection, 'talks');
    assert.equal(data.permalink, '/talks/2025-11-06-the-molecules-that-changed-the-world/');
    assert.equal(data.layout, 'talk', 'layout comes from the talks defaults block');
    assert.equal(data.venue, 'SCUT');
  } finally {
    await cleanup();
  }
});

test('pages get a permalink and no date prefix', async () => {
  const { root, cleanup } = await makeTempRepo();
  try {
    const config = await readSiteConfig(root);
    const doc = await createDocument(root, { typeId: 'page', title: 'About Me', body: 'Hi\n', config });
    assert.equal(doc.path, '_pages/about-me.md');
    const data = yaml.load((await readRaw(root, doc.path)).split('---')[1]);
    assert.equal(data.permalink, '/about-me/');
    assert.equal(data.layout, 'single');
  } finally {
    await cleanup();
  }
});

test('drafts live in _drafts and publish into _posts with the date prefix', async () => {
  const { root, cleanup } = await makeTempRepo();
  try {
    const config = await readSiteConfig(root);
    const doc = await createDocument(root, {
      typeId: 'post',
      title: 'Draft One',
      date: '2025-05-06',
      draft: true,
      body: 'wip\n',
      config,
    });
    assert.equal(doc.path, '_drafts/draft-one.md');
    assert.equal(doc.draft, true);
    assert.match(await readRaw(root, doc.path), /^date: 2025-05-06$/m);

    const published = await publishDraft(root, { path: doc.path, date: '2025-06-07', config });
    assert.equal(published.path, '_posts/2025-06-07-draft-one.md');
    await assert.rejects(fs.access(path.join(root, '_drafts', 'draft-one.md')));
    assert.match(await readRaw(root, published.path), /^date: 2025-06-07$/m);
  } finally {
    await cleanup();
  }
});

test('saving preserves hand-written extra front matter fields', async () => {
  const { root, cleanup } = await makeTempRepo();
  try {
    const config = await readSiteConfig(root);
    const doc = await createDocument(root, {
      typeId: 'post',
      title: 'With Extras',
      date: '2025-03-04',
      values: { tags: ['a'] },
      body: 'one\n',
      config,
    });

    const abs = path.join(root, doc.path);
    const raw = await fs.readFile(abs, 'utf8');
    await fs.writeFile(abs, raw.replace('tags:', 'math: true\ntags:'), 'utf8');
    const stat = await fs.stat(abs);

    const saved = await saveDocument(root, {
      path: doc.path,
      values: { title: 'With Extras', tags: ['b'], excerpt: 'new excerpt' },
      body: 'two\n',
      expectedMtimeMs: stat.mtimeMs,
      config,
    });

    assert.equal(saved.data.math, true, 'custom key survived');
    assert.deepEqual(saved.data.tags, ['b']);
    assert.equal(saved.data.excerpt, 'new excerpt');
    assert.match(await readRaw(root, doc.path), /two/);
  } finally {
    await cleanup();
  }
});

test('external modification is detected instead of overwritten', async () => {
  const { root, cleanup } = await makeTempRepo();
  try {
    const config = await readSiteConfig(root);
    const doc = await createDocument(root, { typeId: 'post', title: 'Guard', date: '2025-03-04', body: 'x', config });
    await assert.rejects(
      () => saveDocument(root, { path: doc.path, values: { title: 'Guard' }, body: 'y', expectedMtimeMs: 1, config }),
      (err) => err.code === 'FILE_CONFLICT',
    );
  } finally {
    await cleanup();
  }
});

test('lists posts, drafts and pages with the right type ids', async () => {
  const { root, cleanup } = await makeTempRepo();
  try {
    const config = await readSiteConfig(root);
    await createDocument(root, { typeId: 'post', title: 'Published', date: '2025-01-01', body: 'p', config });
    await createDocument(root, { typeId: 'post', title: 'Draft', date: '2025-01-02', draft: true, body: 'd', config });
    await createDocument(root, { typeId: 'page', title: 'Contact', body: 'c', config });

    const docs = await listDocuments(root, { config });
    const titles = docs.map((d) => d.title).sort();
    assert.deepEqual(titles, ['Contact', 'Draft', 'Published']);

    const drafts = docs.filter((d) => d.draft);
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].typeId, 'post');

    const postsOnly = await listDocuments(root, { typeId: 'post', config });
    assert.equal(postsOnly.length, 2);
  } finally {
    await cleanup();
  }
});

test('rename moves the file and keeps the YAML date in sync', async () => {
  const { root, cleanup } = await makeTempRepo();
  try {
    const config = await readSiteConfig(root);
    const doc = await createDocument(root, { typeId: 'post', title: 'Old Name', date: '2025-01-01', body: 'x', config });
    const renamed = await renameDocument(root, { path: doc.path, slug: 'new-name', date: '2025-02-02', config });
    assert.equal(renamed.path, '_posts/2025-02-02-new-name.md');
    assert.match(await readRaw(root, renamed.path), /^date: 2025-02-02$/m);
    await assert.rejects(fs.access(path.join(root, doc.path)));
  } finally {
    await cleanup();
  }
});

test('delete removes the file', async () => {
  const { root, cleanup } = await makeTempRepo();
  try {
    const config = await readSiteConfig(root);
    const doc = await createDocument(root, { typeId: 'post', title: 'Delete Me', date: '2025-01-01', body: 'x', config });
    const result = await deleteDocument(root, doc.path);
    assert.equal(result.ok, true);
    await assert.rejects(fs.access(path.join(root, doc.path)));
  } finally {
    await cleanup();
  }
});

test('duplicate titles get a numeric suffix instead of overwriting', async () => {
  const { root, cleanup } = await makeTempRepo();
  try {
    const config = await readSiteConfig(root);
    const first = await createDocument(root, { typeId: 'post', title: 'Same', date: '2025-01-01', body: '1', config });
    const second = await createDocument(root, { typeId: 'post', title: 'Same', date: '2025-01-01', body: '2', config });
    assert.notEqual(first.path, second.path);
    assert.equal(second.path, '_posts/2025-01-01-same-2.md');
  } finally {
    await cleanup();
  }
});

test('type detection maps real directories to type ids', async () => {
  const { root, cleanup } = await makeTempRepo();
  try {
    const config = await readSiteConfig(root);
    assert.equal(detectTypeId(config, '_posts/2025-01-01-x.md'), 'post');
    assert.equal(detectTypeId(config, '_drafts/x.md'), 'post');
    assert.equal(detectTypeId(config, '_pages/about.md'), 'page');
    assert.equal(detectTypeId(config, '_talks/2025-01-01-x.md'), 'talk');
    assert.equal(detectTypeId(config, '_publications/x.md'), 'publication');
    assert.equal(detectTypeId(config, '_teaching/x.md'), 'teaching');
    assert.equal(detectTypeId(config, '_portfolio/x.md'), 'portfolio');
    assert.equal(detectTypeId(config, 'images/x.md'), null);
  } finally {
    await cleanup();
  }
});

test('readDocument exposes flat header keys for the form', async () => {
  const { root, cleanup } = await makeTempRepo();
  try {
    const config = await readSiteConfig(root);
    const doc = await createDocument(root, {
      typeId: 'post',
      title: 'Teaser',
      date: '2025-01-01',
      values: { 'header.teaser': 'pic.jpg' },
      body: 'x',
      config,
    });
    const full = await readDocument(root, doc.path, config);
    assert.equal(full.flatData['header.teaser'], 'pic.jpg');
    assert.equal(full.flatData.header, undefined);
    assert.equal(full.body, '\nx\n');
    assert.equal(full.typeId, 'post');
  } finally {
    await cleanup();
  }
});
