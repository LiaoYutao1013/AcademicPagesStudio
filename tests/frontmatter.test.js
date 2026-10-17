import test from 'node:test';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';

import {
  buildFrontMatter,
  extraKeys,
  pruneEmpty,
  serializeDocument,
  splitDocument,
} from '../src/main/content/frontmatter.js';
import { diffLines } from '../src/main/util/lineDiff.js';
import { formatScalar, needsQuoting, slugify, splitInlineComment } from '../src/main/util/text.js';

test('splits front matter and body without touching the body', () => {
  const raw = '---\ntitle: "Hello"\ndate: 2025-01-02\nheader:\n  teaser: pic.jpg\n---\n\n正文第一段。\n\n- 列表\n';
  const parts = splitDocument(raw);
  assert.equal(parts.hasFrontMatter, true);
  assert.equal(parts.data.title, 'Hello');
  assert.equal(parts.data.header.teaser, 'pic.jpg');
  assert.equal(parts.body, '\n正文第一段。\n\n- 列表\n');
  assert.equal(parts.error, null);
});

test('serialises dates unquoted and keeps nested header', () => {
  const parts = splitDocument('---\ntitle: "X"\n---\n\nBody\n');
  const out = serializeDocument(parts.data, parts.body);
  assert.match(out, /^---\ntitle: X\n---\n\nBody\n$/);
});

test('date fields are unquoted even when js-yaml quotes them', () => {
  const out = serializeDocument({ title: 'T', date: '2025-03-04', last_modified_at: '2025-04-05' }, 'body');
  assert.match(out, /^date: 2025-03-04$/m);
  assert.match(out, /^last_modified_at: 2025-04-05$/m);
  assert.equal(yaml.load(out.split('---')[1]).date instanceof Date, true);
});

test('front matter errors are reported, not thrown away', () => {
  const parts = splitDocument('---\ntitle: [unclosed\n---\nbody');
  assert.equal(parts.hasFrontMatter, true);
  assert.ok(parts.error);
  assert.equal(parts.body, 'body');
});

test('documents without front matter are passed through', () => {
  const parts = splitDocument('# Just markdown\n');
  assert.equal(parts.hasFrontMatter, false);
  assert.equal(parts.body, '# Just markdown\n');
});

test('buildFrontMatter injects defaults, nests dotted keys and preserves extras', () => {
  const data = buildFrontMatter({
    inherited: { layout: 'single', author_profile: true, read_time: true },
    ordered: [{ key: 'title' }, { key: 'excerpt' }, { key: 'header.teaser' }],
    values: { title: 'Hello', excerpt: '', 'header.teaser': 'teaser.jpg' },
    computed: { collection: 'talks', permalink: '/talks/2025-01-01-hello/' },
    extra: { math: true, custom: 'kept' },
  });

  assert.deepEqual(data, {
    layout: 'single',
    author_profile: true,
    read_time: true,
    title: 'Hello',
    header: { teaser: 'teaser.jpg' },
    collection: 'talks',
    permalink: '/talks/2025-01-01-hello/',
    math: true,
    custom: 'kept',
  });
  assert.equal(extraKeys(data, ['title', 'collection']).math, true);
});

test('pruneEmpty drops empty strings, empty arrays and empty nested objects', () => {
  assert.deepEqual(pruneEmpty({ a: '', b: [], c: { d: '' }, e: false, f: 0, g: 'x' }), { e: false, f: 0, g: 'x' });
});

test('scalar formatting preserves quote style and quotes unsafe plain values', () => {
  assert.equal(formatScalar('hello', 'plain'), 'hello');
  assert.equal(formatScalar('My_Selfish.jpg', 'double'), '"My_Selfish.jpg"');
  assert.equal(formatScalar("it's", 'single'), "'it''s'");
  assert.equal(formatScalar('a: b', 'plain'), '"a: b"');
  assert.equal(formatScalar('yes', 'plain'), '"yes"');
  assert.equal(formatScalar('2025-01-02', 'plain'), '"2025-01-02"');
  assert.equal(formatScalar('', 'plain'), '');
  assert.equal(needsQuoting('https://example.com/a'), false);
  assert.equal(needsQuoting('#tag'), true);
});

test('inline comment splitter respects quotes', () => {
  assert.deepEqual(splitInlineComment(' "a # b"'), { code: ' "a # b"', comment: '' });
  assert.deepEqual(splitInlineComment(' x # note'), { code: ' x ', comment: '# note' });
  assert.deepEqual(splitInlineComment(' # only'), { code: ' ', comment: '# only' });
});

test('slugify handles ASCII and CJK', () => {
  assert.equal(slugify('Hello, World! 2025'), 'hello-world-2025');
  assert.equal(slugify('My Talk: A & B'), 'my-talk-a-b');
  assert.equal(slugify('中文标题'), '中文标题');
  assert.equal(slugify('---'), '');
});

test('line diff reports additions, deletions and unchanged files', () => {
  const same = diffLines('a\nb\n', 'a\nb\n');
  assert.equal(same.changed, false);
  assert.equal(same.hunks.length, 0);

  const diff = diffLines('a\nb\nc', 'a\nB\nc');
  assert.equal(diff.changed, true);
  assert.equal(diff.added, 1);
  assert.equal(diff.removed, 1);
  assert.deepEqual(diff.hunks[0].lines.map((l) => l.type), ['context', 'del', 'add', 'context']);
});
