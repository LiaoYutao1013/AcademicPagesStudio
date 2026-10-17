import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';

import { commentLines, makeTempRepo, readFixtureLf, toLines } from './helpers.js';
import {
  applyCollectionPlan,
  archivePageSource,
  buildConfigText,
  checkPlan,
  planCollection,
  previewCollection,
} from '../src/main/config/collectionsService.js';
import { readSiteConfig } from '../src/main/config/siteConfig.js';
import { parseNavigation } from '../src/main/config/navigationService.js';

const baseInput = {
  label: 'Projects',
  title: 'Projects',
  intro: 'Selected engineering work.',
  includeNav: true,
  navUrl: '/projects/',
};

test('plan normalises the label and derives paths and URLs', () => {
  const plan = planCollection(baseInput);
  assert.equal(plan.label, 'projects');
  assert.equal(plan.dir, '_projects');
  assert.equal(plan.pagePath, '_pages/projects.html');
  assert.equal(plan.permalink, '/:collection/:path/');
  assert.equal(plan.archiveUrl, '/projects/');
  assert.equal(plan.layout, 'single');
});

test('config patch adds a collection and a defaults entry, comments intact', async () => {
  const before = await readFixtureLf('_config.yml');
  const plan = planCollection(baseInput);
  const after = buildConfigText(before, plan);

  const data = yaml.load(after);
  assert.equal(data.collections.projects.output, true);
  assert.equal(data.collections.projects.permalink, '/:collection/:path/');
  const defaults = data.defaults.find((entry) => entry.scope.type === 'projects');
  assert.deepEqual(defaults.values, {
    layout: 'single',
    author_profile: true,
    share: true,
    comments: true,
  });
  assert.equal(data.defaults.length, yaml.load(before).defaults.length + 1);

  // Every pre-existing comment survives the append.
  const afterComments = commentLines(after);
  for (const comment of commentLines(before)) {
    assert.ok(afterComments.includes(comment), `missing comment: ${comment}`);
  }

  // Existing collections/defaults values are unchanged.
  assert.deepEqual(data.collections.talks, yaml.load(before).collections.talks);
  assert.equal(data.collections.teaching.output, true);
});

test('existing entries are untouched byte-for-byte before the insertion point', async () => {
  const before = await readFixtureLf('_config.yml');
  const plan = planCollection(baseInput);
  const after = buildConfigText(before, plan);

  const a = toLines(before);
  const b = toLines(after);
  assert.deepEqual(b.slice(0, a.findIndex((l) => /^collections:/.test(l))), a.slice(0, a.findIndex((l) => /^collections:/.test(l))));
});

test('talk layout selects the talk include and archive layout', () => {
  const plan = planCollection({ ...baseInput, layout: 'talk' });
  const page = archivePageSource(plan);
  assert.match(page, /^---\nlayout: archive\n/);
  assert.match(page, /include archive-single-talk\.html/);
  assert.match(page, /site\.projects/);
  assert.match(page, /permalink: \/projects\//);
  assert.match(page, /author_profile: true/);
});

test('the generated archive page follows Academic Pages conventions', () => {
  const page = archivePageSource(planCollection(baseInput));
  assert.match(page, /layout: archive/);
  assert.match(page, /\{% include base_path %\}/);
  assert.match(page, /\{% for post in site\.projects %\}/);
  assert.match(page, /\{% endfor %\}/);
  assert.match(page, /Selected engineering work\./);
});

test('invalid labels, duplicates and reserved names are rejected', async () => {
  const { root, cleanup } = await makeTempRepo();
  try {
    const reserved = await checkPlan(root, planCollection({ ...baseInput, label: 'posts' }));
    assert.ok(reserved.errors.some((e) => e.message.includes('保留')));

    const duplicate = await checkPlan(root, planCollection({ ...baseInput, label: 'talks' }));
    assert.ok(duplicate.errors.some((e) => e.message.includes('已存在')));

    const badPermalink = await checkPlan(root, planCollection({ ...baseInput, label: 'notes', permalink: '/notes/:title/' }));
    assert.ok(badPermalink.errors.some((e) => e.message.includes(':collection')));

    const duplicateNav = await checkPlan(root, planCollection({ ...baseInput, label: 'notes', navUrl: '/blog/' }));
    assert.ok(duplicateNav.errors.some((e) => e.message.includes('导航栏')));
  } finally {
    await cleanup();
  }
});

test('preview renders every file without writing', async () => {
  const { root, cleanup } = await makeTempRepo();
  try {
    const plan = planCollection(baseInput);
    const preview = await previewCollection(root, plan);
    assert.equal(preview.errors.length, 0);
    assert.equal(preview.files.length, 3);
    const paths = preview.files.map((f) => f.path);
    assert.deepEqual(paths, ['_config.yml', '_pages/projects.html', '_data/navigation.yml']);

    // Nothing written yet.
    await assert.rejects(fs.access(path.join(root, '_pages', 'projects.html')));
    const config = await fs.readFile(path.join(root, '_config.yml'), 'utf8');
    assert.ok(!config.includes('projects:'));
  } finally {
    await cleanup();
  }
});

test('apply writes config, archive page, nav entry and the collection folder', async () => {
  const { root, cleanup } = await makeTempRepo();
  try {
    const plan = planCollection(baseInput);
    const result = await applyCollectionPlan(root, plan);

    assert.deepEqual(result.paths, ['_config.yml', '_pages/projects.html', '_data/navigation.yml']);

    const config = await readSiteConfig(root);
    assert.ok(config.collections.some((c) => c.label === 'projects' && c.output));
    assert.ok(config.defaults.some((entry) => entry.scope.type === 'projects'));

    const page = await fs.readFile(path.join(root, '_pages', 'projects.html'), 'utf8');
    assert.match(page, /site\.projects/);

    const navText = await fs.readFile(path.join(root, '_data', 'navigation.yml'), 'utf8');
    const nav = parseNavigation(navText);
    assert.equal(nav.items.at(-1).title, 'Projects');
    assert.equal(nav.items.at(-1).url, '/projects/');

    const keep = await fs.readFile(path.join(root, '_projects', '.gitkeep'), 'utf8');
    assert.equal(keep, '');

    // A second identical apply must fail, not silently duplicate.
    await assert.rejects(() => applyCollectionPlan(root, plan), /已存在/);
  } finally {
    await cleanup();
  }
});

test('config remains valid YAML with the same top-level keys', async () => {
  const before = await readFixtureLf('_config.yml');
  const after = buildConfigText(before, planCollection(baseInput));
  const beforeKeys = Object.keys(yaml.load(before));
  const afterKeys = Object.keys(yaml.load(after));
  assert.deepEqual(afterKeys, beforeKeys);
});
