import test from 'node:test';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';

import { commentLines, readFixture, readFixtureLf, toLines } from './helpers.js';
import { readAuthor, updateAuthor, normalizeAvatarName, validateAuthor } from '../src/main/config/authorService.js';

const BLOCK_START = /^author:/;
const BLOCK_END = /^# Publication Category/;

test('author patch only rewrites the intended value tokens', async () => {
  const before = await readFixtureLf('_config.yml');
  const result = updateAuthor(before, {
    name: 'Liao Yutao',
    bio: '本科在读，兴趣为机械工程与智能制造。',
    googlescholar: 'https://scholar.google.com/citations?user=PS_CX0AAAAAJ',
    steam: '',
  });

  const a = toLines(before);
  const b = toLines(result.text);
  assert.equal(a.length, b.length, 'no keys were added or removed');

  const changed = a.map((line, i) => (line === b[i] ? -1 : i)).filter((i) => i >= 0);
  const start = a.findIndex((line) => BLOCK_START.test(line));
  const end = a.findIndex((line) => BLOCK_END.test(line));
  assert.ok(start > 0 && end > start);
  for (const index of changed) {
    assert.ok(index > start && index < end, `line ${index + 1} changed outside the author block: ${a[index]}`);
  }

  // Every comment in the file survives, byte for byte.
  assert.deepEqual(commentLines(before), commentLines(result.text));

  // Everything below the author block is untouched.
  assert.deepEqual(a.slice(end), b.slice(end));
  assert.equal(result.text.endsWith('\n'), before.endsWith('\n'));
});

test('author values are written in place with the original alignment and quoting', async () => {
  const before = await readFixtureLf('_config.yml');
  const { text } = updateAuthor(before, {
    bio: 'A quiet line with a colon: and a # hash, plus "quotes".',
    employer: 'South China University of Technology',
    email: 'bcliaoyutao@mail.scut.edu.cn',
  });

  const lines = toLines(text);
  const bioLine = lines.find((line) => /^ {2}bio\s+:/.test(line));
  assert.ok(bioLine, 'bio line exists');
  // The original file aligns the colon at column 19; the new value keeps it.
  assert.equal(bioLine.indexOf(':'), 19);
  assert.ok(bioLine.includes('"A quiet line with a colon: and a # hash, plus \\"quotes\\"."'), 'value is quoted because it contains ": " and " #"');

  const data = yaml.load(text);
  assert.equal(data.author.bio, 'A quiet line with a colon: and a # hash, plus "quotes".');
  assert.equal(data.author.employer, 'South China University of Technology');
  assert.equal(data.author.email, 'bcliaoyutao@mail.scut.edu.cn');
});

test('clearing a field keeps its inline comment marker', async () => {
  const before = await readFixtureLf('_config.yml');
  const filled = updateAuthor(before, { academia: 'https://scut.academia.edu/YutaoLiao' }).text;
  assert.match(filled, /^ {2}academia\s+: https:\/\/scut\.academia\.edu\/YutaoLiao # URL$/m);

  const cleared = updateAuthor(filled, { academia: '' }).text;
  assert.match(cleared, /^ {2}academia\s+: # URL$/m);
  assert.equal(yaml.load(cleared).author.academia, null);
});

test('missing keys are appended inside the block, aligned, without touching comments', async () => {
  const before = await readFixtureLf('_config.yml');
  // Drop a known key to simulate an older config file.
  const withoutZotero = toLines(before).filter((line) => !/^ {2}zotero\s+:/.test(line)).join('\n') + '\n';
  assert.ok(!withoutZotero.includes('zotero'));

  const { text, addedKeys } = updateAuthor(withoutZotero, { zotero: 'https://www.zotero.org/yutao' });
  assert.deepEqual(addedKeys, ['zotero']);

  const lines = toLines(text);
  const start = lines.findIndex((line) => BLOCK_START.test(line));
  const end = lines.findIndex((line) => BLOCK_END.test(line));
  const zoteroLine = lines.find((line) => /^ {2}zotero\s+:/.test(line));
  const zoteroIndex = lines.indexOf(zoteroLine);
  assert.ok(zoteroIndex > start && zoteroIndex < end, 'appended key stays inside the author block');
  assert.equal(zoteroLine.indexOf(':'), 19, 'appended key follows the existing colon column');
  assert.equal(yaml.load(text).author.zotero, 'https://www.zotero.org/yutao');

  // The original comments are still all present, and only two section-level
  // comments were not invented.
  assert.deepEqual(commentLines(withoutZotero), commentLines(text));
});

test('unknown user keys under author are left alone', async () => {
  const before = await readFixtureLf('_config.yml');
  const withExtra = before.replace('  pronouns         :\n', '  pronouns         :\n  custom_title     : "Lab Lead"\n');
  const { text } = updateAuthor(withExtra, { pronouns: 'he/him' });
  const data = yaml.load(text);
  assert.equal(data.author.pronouns, 'he/him');
  assert.equal(data.author.custom_title, 'Lab Lead');

  const { extras } = readAuthor(text);
  assert.equal(extras.custom_title, 'Lab Lead');
});

test('avatar normalisation strips images/ prefixes', () => {
  assert.equal(normalizeAvatarName('images/me.jpg'), 'me.jpg');
  assert.equal(normalizeAvatarName('/images/me.jpg'), 'me.jpg');
  assert.equal(normalizeAvatarName('me.jpg'), 'me.jpg');
  assert.equal(normalizeAvatarName('https://cdn.example.com/me.jpg'), 'https://cdn.example.com/me.jpg');
});

test('validation rejects path-like avatars and bad emails', () => {
  const bad = validateAuthor({ avatar: 'C:\\Users\\me\\photo.jpg', email: 'not-an-email' });
  assert.equal(bad.errors.length, 2);
  assert.deepEqual(bad.errors.map((e) => e.key).sort(), ['avatar', 'email']);

  const urlInUsername = validateAuthor({ github: 'https://github.com/LiaoYutao1013' });
  assert.ok(urlInUsername.warnings.some((w) => w.key === 'github'), 'warns about a URL in a username field');
});

test('the whole file still parses and every other top-level block is identical', async () => {
  const before = await readFixtureLf('_config.yml');
  const after = updateAuthor(before, { location: 'Guangzhou, Guangdong, China' }).text;

  const dataBefore = yaml.load(before);
  const dataAfter = yaml.load(after);
  for (const key of ['collections', 'defaults', 'publication_category', 'plugins', 'kramdown', 'exclude', 'include']) {
    assert.deepEqual(dataAfter[key], dataBefore[key], `${key} unchanged`);
  }
  assert.equal(dataAfter.author.location, 'Guangzhou, Guangdong, China');
  assert.equal(dataAfter.author.name, dataBefore.author.name);
});

test('CRLF files stay CRLF after an edit', async () => {
  const before = (await readFixture('_config.yml')).replace(/\r?\n/g, '\r\n');
  const { text } = updateAuthor(before, { location: 'Guangzhou' });
  assert.ok(!/(?<!\r)\n/.test(text), 'no lone LF was introduced');
  assert.equal(
    (text.match(/\r\n/g) ?? []).length,
    (before.match(/\r\n/g) ?? []).length,
    'line count is unchanged',
  );
  assert.equal(yaml.load(text).author.location, 'Guangzhou');
});
