/**
 * Git orchestration.
 *
 * Local operations use the system git binary; authenticated network operations
 * use isomorphic-git (see `isoGit.js` for the credential-hygiene rationale).
 *
 * Sync shape:
 *   1. commit local edits (separate from pushing, so "save locally" and
 *      "publish" are two different user actions),
 *   2. optionally fetch + rebase onto the remote branch,
 *   3. push.
 * Conflicts abort the rebase and are reported as `GIT_CONFLICT` with the file
 * list, never as a generic failure.
 */

import { AppError, codes, summarizeGitError } from '../util/errors.js';
import { runGit, runGitInput, isGitAvailable } from './gitRunner.js';
import { isoFetch, isoPush } from './isoGit.js';

const CONFLICT_CODES = new Set(['UU', 'AA', 'DD', 'AU', 'UA', 'DU', 'UD']);

/** @param {string} root */
export async function assertGitRepo(root) {
  if (!(await isGitAvailable())) {
    throw new AppError(codes.GIT_UNAVAILABLE, '系统未安装 git，或 git 不在 PATH 中', {});
  }
  const result = await runGit(root, ['rev-parse', '--is-inside-work-tree'], { allowFailure: true });
  if (result.code !== 0 || result.stdout.trim() !== 'true') {
    throw new AppError(codes.GIT_ERROR, '该目录不是 Git 仓库（缺少 .git）', { root });
  }
  const top = await runGit(root, ['rev-parse', '--show-toplevel'], { allowFailure: true });
  return { topLevel: top.code === 0 ? top.stdout.trim() : root };
}

/** @param {string} root */
export async function getRemoteUrl(root) {
  const result = await runGit(root, ['remote', 'get-url', 'origin'], { allowFailure: true });
  return result.code === 0 ? result.stdout.trim() : null;
}

/**
 * Normalise a remote to an HTTPS URL suitable for isomorphic-git.
 * @param {string | null} remoteUrl
 */
export function toHttpsRemote(remoteUrl) {
  if (!remoteUrl) return null;
  const scpLike = /^git@([^:]+):(.+)$/.exec(remoteUrl);
  if (scpLike) return `https://${scpLike[1]}/${scpLike[2].replace(/\.git$/, '')}.git`;
  const ssh = /^ssh:\/\/git@([^/]+)\/(.+)$/.exec(remoteUrl);
  if (ssh) return `https://${ssh[1]}/${ssh[2].replace(/\.git$/, '')}.git`;
  if (/^https?:\/\//.test(remoteUrl)) return remoteUrl;
  return remoteUrl;
}

/** @typedef {{ path: string, index: string, worktree: string }} StatusEntry */

/**
 * @param {string} root
 * @returns {Promise<{
 *   branch: string,
 *   upstream: string | null,
 *   ahead: number,
 *   behind: number,
 *   clean: boolean,
 *   hasCommits: boolean,
 *   remoteUrl: string | null,
 *   staged: StatusEntry[],
 *   unstaged: StatusEntry[],
 *   untracked: StatusEntry[],
 *   conflicts: string[],
 * }>}
 */
export async function getStatus(root) {
  await assertGitRepo(root);

  const hasCommits = (await runGit(root, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true })).code === 0;
  // `symbolic-ref` works on a repository that has no commits yet, where
  // `rev-parse HEAD` would fail.
  const symbolic = await runGit(root, ['symbolic-ref', '--short', 'HEAD'], { allowFailure: true });
  const branchRes = symbolic.code === 0
    ? symbolic
    : await runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD'], { allowFailure: true });
  const branch = branchRes.code === 0 ? branchRes.stdout.trim() : 'HEAD';

  const upstreamRes = await runGit(
    root,
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
    { allowFailure: true },
  );
  const upstream = upstreamRes.code === 0 ? upstreamRes.stdout.trim() : null;

  const statusRes = await runGit(root, ['status', '--porcelain=v1', '-uall']);
  /** @type {StatusEntry[]} */
  const staged = [];
  /** @type {StatusEntry[]} */
  const unstaged = [];
  /** @type {StatusEntry[]} */
  const untracked = [];
  /** @type {string[]} */
  const conflicts = [];

  for (const line of statusRes.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const index = line[0];
    const worktree = line[1];
    let entryPath = line.slice(3);
    if (entryPath.includes(' -> ')) entryPath = entryPath.split(' -> ').pop() ?? entryPath;
    const entry = { path: entryPath, index, worktree };

    if (index === '?' && worktree === '?') {
      untracked.push(entry);
      continue;
    }
    if (CONFLICT_CODES.has(`${index}${worktree}`) || index === 'U' || worktree === 'U') {
      conflicts.push(entryPath);
    }
    if (index !== ' ' && index !== '?') staged.push(entry);
    if (worktree !== ' ' && worktree !== '?') unstaged.push(entry);
  }

  let ahead = 0;
  let behind = 0;
  if (upstream && hasCommits) {
    const count = await runGit(root, ['rev-list', '--left-right', '--count', '@{u}...HEAD'], { allowFailure: true });
    if (count.code === 0) {
      const [behindText, aheadText] = count.stdout.trim().split(/\s+/);
      behind = Number.parseInt(behindText ?? '0', 10) || 0;
      ahead = Number.parseInt(aheadText ?? '0', 10) || 0;
    }
  }

  return {
    branch,
    upstream,
    ahead,
    behind,
    clean: staged.length === 0 && unstaged.length === 0 && untracked.length === 0,
    hasCommits,
    remoteUrl: await getRemoteUrl(root),
    staged,
    unstaged,
    untracked,
    conflicts,
  };
}

/**
 * Diff for review. `paths` limits the diff to the files the app touched.
 * @param {string} root
 * @param {{ paths?: string[], staged?: boolean }} [opts]
 */
export async function getDiff(root, opts = {}) {
  await assertGitRepo(root);
  const paths = opts.paths?.length ? ['--', ...opts.paths] : [];
  const unstaged = await runGit(root, ['diff', '--no-color', '--unified=3', ...paths], { allowFailure: true });
  const staged = await runGit(root, ['diff', '--cached', '--no-color', '--unified=3', ...paths], { allowFailure: true });
  return { unstaged: unstaged.stdout, staged: staged.stdout };
}

/**
 * Stage paths (or everything).
 * @param {string} root
 * @param {string[]} [paths]
 */
export async function stagePaths(root, paths) {
  await assertGitRepo(root);
  if (paths && paths.length) {
    await runGit(root, ['add', '--', ...paths]);
  } else {
    await runGit(root, ['add', '-A']);
  }
  return { ok: true, paths: paths ?? null };
}

/**
 * Commit staged changes.
 * @param {string} root
 * @param {{ message: string, paths?: string[] }} input
 */
export async function commit(root, input) {
  const message = String(input.message ?? '').trim();
  if (!message) throw new AppError(codes.VALIDATION, '提交信息不能为空', {});

  await stagePaths(root, input.paths);

  const staged = await runGit(root, ['diff', '--cached', '--quiet'], { allowFailure: true });
  if (staged.code === 0) {
    return { committed: false, hash: null, message, nothingStaged: true };
  }

  const result = await runGitInput(root, ['commit', '-F', '-'], `${message}\n`, { timeout: 60_000 });
  if (result.code !== 0) {
    throw new AppError(codes.GIT_ERROR, summarizeGitError(result.stderr), { stderr: result.stderr });
  }
  const hashRes = await runGit(root, ['rev-parse', 'HEAD'], { allowFailure: true });
  return {
    committed: true,
    hash: hashRes.code === 0 ? hashRes.stdout.trim() : null,
    message,
    stdout: result.stdout.trim(),
  };
}

/**
 * Fetch the upstream branch. Uses isomorphic-git when a token is supplied.
 * @param {string} root
 * @param {{ token?: string | null }} [opts]
 */
export async function fetchRemote(root, opts = {}) {
  await assertGitRepo(root);
  const status = await getStatus(root);
  if (!status.upstream) throw new AppError(codes.GIT_ERROR, '当前分支没有上游分支（upstream）', { branch: status.branch });

  if (opts.token) {
    const remoteUrl = toHttpsRemote(status.remoteUrl);
    const remoteBranch = status.upstream.split('/').slice(1).join('/') || status.branch;
    await isoFetch({ root, url: remoteUrl, token: opts.token, branch: remoteBranch });
    return { ok: true, method: 'isomorphic-git' };
  }

  const result = await runGit(root, ['fetch', '--prune', 'origin'], { allowFailure: true, timeout: 180_000 });
  if (result.code !== 0) {
    const message = summarizeGitError(result.stderr);
    if (/auth|denied|403/i.test(message)) {
      throw new AppError(codes.GIT_AUTH_MISSING, '拉取需要认证：请先设置 GitHub Token', {});
    }
    throw new AppError(codes.GIT_ERROR, message, {});
  }
  return { ok: true, method: 'git' };
}

/**
 * Rebase the current branch onto its upstream. On conflict the rebase is
 * aborted so the user's working tree is never left half-merged.
 * @param {string} root
 */
export async function rebaseOntoUpstream(root) {
  await assertGitRepo(root);
  const status = await getStatus(root);
  if (!status.upstream) return { rebased: false, reason: 'no-upstream' };
  if (status.behind === 0) return { rebased: false, reason: 'up-to-date' };

  const result = await runGit(root, ['rebase', status.upstream], { allowFailure: true, timeout: 180_000 });
  if (result.code === 0) {
    return { rebased: true, stdout: result.stdout.trim() };
  }

  const conflictFiles = await runGit(root, ['diff', '--name-only', '--diff-filter=U'], { allowFailure: true });
  await runGit(root, ['rebase', '--abort'], { allowFailure: true });

  const files = conflictFiles.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  throw new AppError(
    codes.GIT_CONFLICT,
    files.length
      ? `与远端提交冲突，已自动撤销 rebase。冲突文件：${files.join(', ')}`
      : `rebase 失败：${summarizeGitError(result.stderr)}`,
    { files, branch: status.branch },
  );
}

/**
 * Push the current branch.
 * @param {string} root
 * @param {{ token?: string | null, onProgress?: (message: string) => void }} [opts]
 */
export async function push(root, opts = {}) {
  await assertGitRepo(root);
  const status = await getStatus(root);
  if (!status.remoteUrl) throw new AppError(codes.GIT_ERROR, '仓库没有 origin 远端', {});

  if (opts.token) {
    const url = toHttpsRemote(status.remoteUrl);
    await isoPush({ root, url, token: opts.token, branch: status.branch, onProgress: opts.onProgress });
    // isomorphic-git does not update the local remote-tracking ref.
    await runGit(root, ['update-ref', `refs/remotes/${status.upstream ?? `origin/${status.branch}`}`, 'HEAD'], {
      allowFailure: true,
    });
    return { ok: true, method: 'isomorphic-git', branch: status.branch };
  }

  const result = await runGit(root, ['push', 'origin', status.branch], { allowFailure: true, timeout: 180_000 });
  if (result.code !== 0) {
    const message = summarizeGitError(result.stderr);
    if (/non-fast-forward|rejected|fetch first/i.test(message)) {
      throw new AppError(codes.GIT_NON_FAST_FORWARD, '远端有新提交，推送被拒绝。请先拉取合并。', {});
    }
    if (/auth|denied|403|credentials/i.test(message)) {
      throw new AppError(codes.GIT_AUTH_MISSING, '推送需要认证：请先设置 GitHub Token（或配置系统凭据管理器）', {});
    }
    throw new AppError(codes.GIT_ERROR, message, {});
  }
  return { ok: true, method: 'git', branch: status.branch };
}

/**
 * Commit + optional pull/rebase + push.
 *
 * @param {string} root
 * @param {{
 *   message: string,
 *   token?: string | null,
 *   pull?: boolean,
 *   onProgress?: (stage: string, message: string) => void,
 * }} input
 */
export async function sync(root, input) {
  const onProgress = input.onProgress ?? (() => {});
  await assertGitRepo(root);

  onProgress('commit', '正在提交本地更改…');
  const commitResult = await commit(root, { message: input.message });

  let rebased = false;
  if (input.pull !== false) {
    onProgress('fetch', '正在获取远端更新…');
    try {
      await fetchRemote(root, { token: input.token });
    } catch (err) {
      // A failed fetch must not lose the local commit; report it as a warning.
      onProgress('fetch-warning', err instanceof Error ? err.message : String(err));
    }
    onProgress('rebase', '正在同步远端提交…');
    const rebaseResult = await rebaseOntoUpstream(root);
    rebased = Boolean(rebaseResult.rebased);
  }

  const afterRebase = await getStatus(root);
  let pushed = false;
  if (afterRebase.ahead > 0 || commitResult.committed || !afterRebase.upstream) {
    onProgress('push', '正在推送到 GitHub…');
    await push(root, { token: input.token, onProgress: (m) => onProgress('push', m) });
    pushed = true;
  }

  const finalStatus = await getStatus(root);
  return {
    committed: commitResult.committed,
    commitHash: commitResult.hash,
    rebased,
    pushed,
    upToDate: !commitResult.committed && !rebased && !pushed,
    status: finalStatus,
  };
}

/**
 * Recent commits.
 * @param {string} root
 * @param {number} [limit]
 */
export async function getLog(root, limit = 20) {
  await assertGitRepo(root);
  const result = await runGit(
    root,
    ['log', `-n${Math.max(1, Math.min(100, limit))}`, '--pretty=format:%H%x09%an%x09%aI%x09%s'],
    { allowFailure: true },
  );
  if (result.code !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [hash, author, date, subject] = line.split('\t');
      return { hash, shortHash: hash.slice(0, 7), author, date, subject };
    });
}
