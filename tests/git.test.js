import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { isGitAvailable, runGit } from '../src/main/git/gitRunner.js';
import {
  commit,
  getDiff,
  getLog,
  getStatus,
  rebaseOntoUpstream,
  sync,
  toHttpsRemote,
} from '../src/main/git/gitService.js';

const GIT = await isGitAvailable();

async function makeGitRepo() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aps-git-'));
  const init = await runGit(root, ['init', '-b', 'main'], { allowFailure: true });
  if (init.code !== 0) await runGit(root, ['init']);
  await runGit(root, ['config', 'user.email', 'studio@example.com']);
  await runGit(root, ['config', 'user.name', 'Studio Test']);
  await runGit(root, ['config', 'core.autocrlf', 'false']);
  const branchRes = await runGit(root, ['symbolic-ref', '--short', 'HEAD'], { allowFailure: true });
  const branch = branchRes.code === 0
    ? branchRes.stdout.trim()
    : (await runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
  return { root, branch, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}

async function write(root, name, content) {
  await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
  await fs.writeFile(path.join(root, name), content, 'utf8');
}

test('remote URL normalisation', () => {
  assert.equal(toHttpsRemote('git@github.com:LiaoYutao1013/LiaoYutao1013.github.io.git'), 'https://github.com/LiaoYutao1013/LiaoYutao1013.github.io.git');
  assert.equal(toHttpsRemote('https://github.com/a/b.git'), 'https://github.com/a/b.git');
  assert.equal(toHttpsRemote('ssh://git@github.com/a/b.git'), 'https://github.com/a/b.git');
  assert.equal(toHttpsRemote(null), null);
});

test('status → commit → log', { skip: !GIT }, async () => {
  const { root, branch, cleanup } = await makeGitRepo();
  try {
    await write(root, 'a.txt', 'one\n');
    const before = await getStatus(root);
    assert.equal(before.branch, branch);
    assert.equal(before.hasCommits, false);
    assert.equal(before.clean, false);
    assert.equal(before.untracked.length, 1);
    assert.equal(before.untracked[0].path, 'a.txt');

    const first = await commit(root, { message: 'init' });
    assert.equal(first.committed, true);
    assert.equal(first.hash.length, 40);

    const after = await getStatus(root);
    assert.equal(after.clean, true);
    assert.equal(after.ahead, 0);
    assert.equal(after.behind, 0);

    const log = await getLog(root, 5);
    assert.equal(log.length, 1);
    assert.equal(log[0].subject, 'init');

    await write(root, 'b.txt', 'two\n');
    const second = await commit(root, { message: 'add b' });
    assert.equal(second.committed, true);

    const noop = await commit(root, { message: 'nothing to do' });
    assert.equal(noop.committed, false);
    assert.equal(noop.nothingStaged, true);

    await assert.rejects(() => commit(root, { message: '  ' }), /提交信息不能为空/);
  } finally {
    await cleanup();
  }
});

test('diff returns patch text for review', { skip: !GIT }, async () => {
  const { root, cleanup } = await makeGitRepo();
  try {
    await write(root, 'a.txt', 'old line\n');
    await commit(root, { message: 'init' });
    await write(root, 'a.txt', 'new line\n');

    const diff = await getDiff(root, { paths: ['a.txt'] });
    assert.match(diff.unstaged, /^-old line$/m);
    assert.match(diff.unstaged, /^\+new line$/m);
  } finally {
    await cleanup();
  }
});

test('merge conflicts are surfaced by status', { skip: !GIT }, async () => {
  const { root, cleanup } = await makeGitRepo();
  try {
    await write(root, 'a.txt', 'base\n');
    await commit(root, { message: 'base' });

    await runGit(root, ['checkout', '-b', 'feature']);
    await write(root, 'a.txt', 'feature\n');
    await commit(root, { message: 'feature' });

    const main = (await runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
    await runGit(root, ['checkout', main === 'feature' ? 'main' : main]);
    // Return to the base branch we started on.
    const branches = (await runGit(root, ['branch', '--format=%(refname:short)'])).stdout.split(/\s+/).filter(Boolean);
    const base = branches.find((b) => b !== 'feature');
    await runGit(root, ['checkout', base]);
    await write(root, 'a.txt', 'base changed\n');
    await commit(root, { message: 'base change' });

    const merge = await runGit(root, ['merge', 'feature'], { allowFailure: true });
    assert.notEqual(merge.code, 0);

    const status = await getStatus(root);
    assert.ok(status.conflicts.includes('a.txt'), 'conflict list contains a.txt');
  } finally {
    await cleanup();
  }
});

test('sync pulls, rebases and pushes to a local remote', { skip: !GIT }, async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'aps-sync-'));
  const remote = path.join(base, 'remote.git');
  const a = path.join(base, 'a');
  const b = path.join(base, 'b');
  try {
    await fs.mkdir(remote);
    await runGit(remote, ['init', '--bare', '-b', 'main'], { allowFailure: true });

    await fs.mkdir(a);
    await runGit(a, ['init', '-b', 'main'], { allowFailure: true });
    await runGit(a, ['config', 'user.email', 'a@example.com']);
    await runGit(a, ['config', 'user.name', 'A']);
    await write(a, 'post.md', 'hello\n');
    await commit(a, { message: 'init' });
    const branch = (await runGit(a, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
    await runGit(a, ['remote', 'add', 'origin', remote]);
    await runGit(a, ['push', '-u', 'origin', branch]);

    // A second clone adds a commit that `a` does not have.
    await runGit(base, ['clone', remote, b]);
    await runGit(b, ['config', 'user.email', 'b@example.com']);
    await runGit(b, ['config', 'user.name', 'B']);
    await write(b, 'other.md', 'from b\n');
    await commit(b, { message: 'from b' });
    await runGit(b, ['push', 'origin', branch]);

    // `a` edits a different file, then syncs (commit → fetch → rebase → push).
    await write(a, 'post.md', 'hello from a\n');
    const result = await sync(a, { message: 'from a', token: null, pull: true });
    assert.equal(result.committed, true);
    assert.equal(result.rebased, true, 'picked up the remote commit via rebase');
    assert.equal(result.pushed, true);
    assert.equal(result.status.ahead, 0);
    assert.equal(result.status.behind, 0);

    const log = await getLog(a, 10);
    const subjects = log.map((entry) => entry.subject);
    assert.ok(subjects.includes('from b'));
    assert.ok(subjects.includes('from a'));

    const remoteLog = (await runGit(remote, ['log', '--pretty=format:%s', branch])).stdout;
    assert.match(remoteLog, /from a/);
    assert.match(remoteLog, /from b/);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test('rebase conflicts abort cleanly instead of leaving a half-merged tree', { skip: !GIT }, async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'aps-conflict-'));
  const remote = path.join(base, 'remote.git');
  const a = path.join(base, 'a');
  const b = path.join(base, 'b');
  try {
    await fs.mkdir(remote);
    await runGit(remote, ['init', '--bare', '-b', 'main'], { allowFailure: true });

    await fs.mkdir(a);
    await runGit(a, ['init', '-b', 'main'], { allowFailure: true });
    await runGit(a, ['config', 'user.email', 'a@example.com']);
    await runGit(a, ['config', 'user.name', 'A']);
    await write(a, 'post.md', 'base\n');
    await commit(a, { message: 'init' });
    const branch = (await runGit(a, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
    await runGit(a, ['remote', 'add', 'origin', remote]);
    await runGit(a, ['push', '-u', 'origin', branch]);

    await runGit(base, ['clone', remote, b]);
    await runGit(b, ['config', 'user.email', 'b@example.com']);
    await runGit(b, ['config', 'user.name', 'B']);
    await write(b, 'post.md', 'remote change\n');
    await commit(b, { message: 'remote change' });
    await runGit(b, ['push', 'origin', branch]);

    await write(a, 'post.md', 'local change\n');
    await commit(a, { message: 'local change' });

    await assert.rejects(
      async () => {
        await runGit(a, ['fetch', 'origin'], { allowFailure: true });
        await rebaseOntoUpstream(a);
      },
      (err) => {
        assert.equal(err.code, 'GIT_CONFLICT');
        assert.ok(err.details.files.includes('post.md'));
        return true;
      },
    );

    const status = await getStatus(a);
    assert.equal(status.conflicts.length, 0, 'rebase was aborted, no unmerged files');
    assert.match(await fs.readFile(path.join(a, 'post.md'), 'utf8'), /local change/);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});
