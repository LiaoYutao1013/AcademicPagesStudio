#!/usr/bin/env node
/**
 * End-to-end smoke check against a *copy* of your blog repository.
 *
 *   npm run smoke -- "C:\\path\\to\\clone"
 *   npm run smoke -- "C:\\path\\to\\clone" --write
 *
 * Without --write nothing is written: it prints the exact diffs the app would
 * produce for (a) an author edit, (b) a navigation reorder, and (c) a new
 * "Projects" collection. Use --write on a clone to inspect `git diff`.
 *
 * This exists because the YAML surgery is the riskiest part of the app; being
 * able to eyeball a byte-level diff before trusting the GUI is worth a script.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { readSiteConfig, assertRepository } from '../src/main/config/siteConfig.js';
import { readAuthor, updateAuthor } from '../src/main/config/authorService.js';
import { parseNavigation, updateNavigation } from '../src/main/config/navigationService.js';
import { planCollection, previewCollection, applyCollectionPlan } from '../src/main/config/collectionsService.js';
import { readNavigationText } from '../src/main/config/siteConfig.js';
import { writeTextFileAtomic, resolveInside } from '../src/main/util/fsSafe.js';
import { diffLines } from '../src/main/util/lineDiff.js';

const execFileAsync = promisify(execFile);

const repoPath = process.argv[2];
const write = process.argv.includes('--write');

if (!repoPath) {
  console.error('用法: npm run smoke -- <仓库路径> [--write]');
  process.exit(2);
}

function printDiff(label, before, after) {
  const { hunks, added, removed, changed } = diffLines(before, after);
  console.log(`\n### ${label}  (+${added} / -${removed})`);
  if (!changed) {
    console.log('  (没有变化)');
    return;
  }
  for (const hunk of hunks) {
    console.log(`  ${hunk.header}`);
    for (const line of hunk.lines) {
      const marker = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
      console.log(`  ${marker}${line.text}`);
    }
  }
}

const repo = await assertRepository(repoPath);
console.log(`仓库: ${repo.root}`);

const config = await readSiteConfig(repo.root);

// 1. Author edit -------------------------------------------------------------
const author = readAuthor(config.raw);
const authorPatch = { pronouns: author.values.pronouns || 'he/him' };
const authorPreview = updateAuthor(config.raw, authorPatch);
printDiff('个人资料 (_config.yml → author:)', config.raw, authorPreview.text);
console.log(`  变更字段: ${authorPreview.changedKeys.join(', ') || '(无)'}`);
if (authorPreview.warnings.length) {
  console.log(`  提醒: ${authorPreview.warnings.map((w) => w.message).join(' / ')}`);
}

// 2. Navigation reorder -----------------------------------------------------
const navText = await readNavigationText(repo.root);
const nav = parseNavigation(navText);
const reordered = nav.items.length > 1 ? [nav.items[0], ...nav.items.slice(2), nav.items[1]] : nav.items;
const navPreview = updateNavigation(navText, reordered);
printDiff('导航栏 (_data/navigation.yml → main:)', navText, navPreview.text);

// 3. New collection ---------------------------------------------------------
const plan = planCollection({
  label: 'projects',
  title: 'Projects',
  layout: 'single',
  includeNav: true,
  navUrl: '/projects/',
  intro: 'Selected engineering and software work.',
});
const collectionPreview = await previewCollection(repo.root, plan);
for (const file of collectionPreview.files) {
  printDiff(`新分区 → ${file.path} (${file.action})`, file.before, file.after);
}
if (collectionPreview.errors.length) {
  console.log(`\n  分区校验失败: ${collectionPreview.errors.map((e) => e.message).join(' / ')}`);
}

if (!write) {
  console.log('\n未写入任何文件。加 --write 后会在该副本上实际应用，可用 git diff 检查。');
  process.exit(0);
}

if (collectionPreview.errors.length) {
  console.error('\n分区校验失败，已停止写入。');
  process.exit(1);
}

await writeTextFileAtomic(resolveInside(repo.root, '_config.yml'), authorPreview.text);
await writeTextFileAtomic(resolveInside(repo.root, '_data/navigation.yml'), navPreview.text);
await applyCollectionPlan(repo.root, plan);

console.log('\n已写入。git diff --stat:');
const { stdout } = await execFileAsync('git', ['diff', '--stat'], { cwd: repo.root, encoding: 'utf8' });
console.log(stdout.trim() || '(git 未跟踪新文件，见 git status)');
const status = await execFileAsync('git', ['status', '--short'], { cwd: repo.root, encoding: 'utf8' });
console.log(status.stdout.trim());
