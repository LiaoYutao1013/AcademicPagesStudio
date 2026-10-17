/**
 * Network operations through isomorphic-git.
 *
 * Why split local and network work?
 *   `git push` needs to authenticate. The usual tricks (token in the remote
 *   URL, `-c http.extraheader=...`, `GIT_ASKPASS`) all put the token somewhere
 *   durable or observable: `.git/config`, the process argument list, or a
 *   helper script on disk. isomorphic-git takes the credential through an
 *   `onAuth` callback that only exists in memory for the duration of the call,
 *   so the PAT never touches the repository or the filesystem.
 *
 * Everything else (status, diff, commit, rebase) stays on the system git
 * binary, which is faster and handles the index/hooks correctly.
 */

import fs from 'node:fs';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';

import { AppError, codes } from '../util/errors.js';

/**
 * @param {{
 *   root: string,
 *   url: string,
 *   token: string,
 *   branch: string,
 *   remote?: string,
 *   onProgress?: (message: string) => void,
 * }} opts
 */
export async function isoPush(opts) {
  const { root, url, token, branch, onProgress } = opts;
  try {
    const result = await git.push({
      fs,
      http,
      dir: root,
      url,
      ref: branch,
      remoteRef: branch,
      force: false,
      onAuth: () => ({ username: 'x-access-token', password: token }),
      onProgress: (event) => {
        if (onProgress && event?.phase) onProgress(`${event.phase} ${event.loaded ?? ''}/${event.total ?? ''}`.trim());
      },
    });

    if (result.ok === false || result.error) {
      const message = result.error || '远端拒绝了推送';
      throw new AppError(codes.GIT_ERROR, message, { branch });
    }
    return { ok: true, refs: result.refs ?? {} };
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    if (/not.*fast.?forward|rejected|non-fast-forward/i.test(message)) {
      throw new AppError(codes.GIT_NON_FAST_FORWARD, '远端包含本地没有的提交，推送被拒绝', { branch });
    }
    if (/auth|401|403|credential/i.test(message)) {
      throw new AppError(codes.GIT_AUTH_FAILED, 'GitHub 认证失败，请检查 Personal Access Token 的权限（需要 repo 写权限）', {});
    }
    throw new AppError(codes.GIT_ERROR, `推送失败: ${message}`, {});
  }
}

/**
 * Fetch through isomorphic-git (same credential-hygiene reasons).
 * @param {{ root: string, url: string, token: string, remote?: string, branch: string }} opts
 */
export async function isoFetch(opts) {
  const { root, url, token, branch, remote = 'origin' } = opts;
  try {
    const result = await git.fetch({
      fs,
      http,
      dir: root,
      url,
      remote,
      ref: branch,
      singleBranch: true,
      tags: false,
      onAuth: () => ({ username: 'x-access-token', password: token }),
    });
    return { ok: true, fetchHead: result.fetchHead ?? null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/auth|401|403/i.test(message)) {
      throw new AppError(codes.GIT_AUTH_FAILED, 'GitHub 认证失败，请检查 Personal Access Token', {});
    }
    throw new AppError(codes.GIT_ERROR, `拉取失败: ${message}`, {});
  }
}
