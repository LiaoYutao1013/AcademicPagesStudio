import test from 'node:test';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';

import { readFixture, toLines } from './helpers.js';
import {
  moveItem,
  parseNavigation,
  serializeNavigation,
  updateNavigation,
  validateNavigation,
} from '../src/main/config/navigationService.js';

const PREAMBLE_LINES = 9; // the comment block above `main:`

test('parses the real navigation file', async () => {
  const text = await readFixture('navigation.yml');
  const { items, blankBetween } = parseNavigation(text);
  assert.deepEqual(items.map((i) => i.title), ['About', 'Talks', 'Blog', 'Projects', 'CV']);
  assert.deepEqual(items.map((i) => i.url), ['/', '/talks/', '/blog/', '/portfolio/', '/cv/']);
  assert.equal(blankBetween, true);
});

test('reordering keeps the preamble, the blank-line style and every other byte', async () => {
  const before = await readFixture('navigation.yml');
  const { items } = parseNavigation(before);
  const reordered = moveItem(items, 0, items.length - 1);
  const { text } = updateNavigation(before, reordered);

  const a = toLines(before);
  const b = toLines(text);
  assert.deepEqual(b.slice(0, PREAMBLE_LINES), a.slice(0, PREAMBLE_LINES), 'preamble comments preserved');

  const parsed = parseNavigation(text).items;
  assert.deepEqual(parsed.map((i) => i.title), ['Talks', 'Blog', 'Projects', 'CV', 'About']);
  assert.deepEqual(parsed.map((i) => i.url), ['/talks/', '/blog/', '/portfolio/', '/cv/', '/']);

  const blanks = (lines) => lines.filter((line) => line.trim() === '').length;
  assert.equal(blanks(b), blanks(a), 'same number of separator lines');
  assert.equal(yaml.load(text).main.length, 5);
});

test('adding an item quotes YAML-hostile titles and preserves the rest', async () => {
  const before = await readFixture('navigation.yml');
  const { items } = parseNavigation(before);
  const withNew = [...items, { title: 'Teaching & Courses: 2026', url: '/teaching/' }];
  const { text } = updateNavigation(before, withNew);

  const parsed = parseNavigation(text).items;
  assert.equal(parsed.length, 6);
  assert.equal(parsed[5].title, 'Teaching & Courses: 2026');
  assert.equal(parsed[5].url, '/teaching/');
  assert.ok(text.includes('"Teaching & Courses: 2026"'), 'colon+ampersand title is quoted');
  assert.deepEqual(toLines(text).slice(0, PREAMBLE_LINES), toLines(before).slice(0, PREAMBLE_LINES));
});

test('external links stay unquoted and untouched', async () => {
  const before = await readFixture('navigation.yml');
  const { items } = parseNavigation(before);
  const { text } = updateNavigation(before, [...items, { title: 'GitHub', url: 'https://github.com/LiaoYutao1013' }]);
  assert.match(text, /url: https:\/\/github\.com\/LiaoYutao1013/);
  assert.equal(parseNavigation(text).items.at(-1).url, 'https://github.com/LiaoYutao1013');
});

test('deleting an item only affects the main list', async () => {
  const before = await readFixture('navigation.yml');
  const { items } = parseNavigation(before);
  const { text } = updateNavigation(before, items.filter((item) => item.title !== 'CV'));

  const parsed = parseNavigation(text).items;
  assert.deepEqual(parsed.map((i) => i.title), ['About', 'Talks', 'Blog', 'Projects']);
  assert.deepEqual(toLines(text).slice(0, PREAMBLE_LINES), toLines(before).slice(0, PREAMBLE_LINES));
});

test('internal URLs are normalised and validated', async () => {
  const before = await readFixture('navigation.yml');
  const { items } = parseNavigation(before);
  const { text } = updateNavigation(before, [...items, { title: 'About 2', url: 'about-me/' }]);
  assert.match(text, /url: \/about-me\//);
});

test('invalid items are rejected before writing', async () => {
  const before = await readFixture('navigation.yml');
  const { items } = parseNavigation(before);

  assert.throws(() => updateNavigation(before, [...items, { title: '', url: '/x/' }]), /标题不能为空/);
  assert.throws(() => updateNavigation(before, [...items, { title: 'X', url: 'javascript:alert(1)' }]), /协议/);
  assert.throws(() => updateNavigation(before, [...items, { title: 'X', url: '/has space/' }]), /空格/);
});

test('duplicate URLs produce warnings, not errors', () => {
  const { errors, warnings } = validateNavigation([
    { title: 'About', url: '/' },
    { title: 'Home', url: '/' },
  ]);
  assert.equal(errors.length, 0);
  assert.ok(warnings.some((w) => w.message.includes('重复')));
});

test('serialiser keeps extra keys and puts title/url first', () => {
  const lines = serializeNavigation([{ title: 'A', url: '/a/', children: undefined, order: 3 }], { blankBetween: false });
  assert.deepEqual(lines, ['  - title: "A"', '    url: /a/', '    order: 3']);
});
