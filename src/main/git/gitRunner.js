/**
 * Thin, injection-resistant wrapper around the system `git` binary.
 *
 * - arguments are passed as an array (never a shell string), so file names can
 *   contain spaces or `&` without escaping bugs;
 * - `GIT_TERMINAL_PROMPT=0` guarantees we never hang on an interactive
 *   credential prompt in a GUI process;
 * - `core.quotepath=false` keeps non-ASCII paths unescaped so they match the
 *   paths the renderer knows about.
 */

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

import { AppError, codes, summarizeGitError } from '../util/errors.js';

const execFileAsync = promisify(execFile);

const BASE_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_CONFIG_NOSYSTEM: '0',
  LC_ALL: 'C',
  LANG: 'C',
};

/** @type {boolean | null} */
let gitAvailableCache = null;

/** @returns {Promise<boolean>} */
export async function isGitAvailable() {
  if (gitAvailableCache !== null) return gitAvailableCache;
  try {
    await execFileAsync('git', ['--version'], { timeout: 5000, windowsHide: true });
    gitAvailableCache = true;
  } catch {
    gitAvailableCache = false;
  }
  return gitAvailableCache;
}

/**
 * @param {string} root
 * @param {string[]} args
 * @param {{ allowFailure?: boolean, timeout?: number, env?: Record<string,string> }} [opts]
 * @returns {Promise<{ stdout: string, stderr: string, code: number }>}
 */
export async function runGit(root, args, opts = {}) {
  const finalArgs = ['-c', 'core.quotepath=false', ...args];
  try {
    const { stdout, stderr } = await execFileAsync('git', finalArgs, {
      cwd: root,
      env: { ...process.env, ...BASE_ENV, ...(opts.env ?? {}) },
      maxBuffer: 32 * 1024 * 1024,
      timeout: opts.timeout ?? 120_000,
      windowsHide: true,
      encoding: 'utf8',
    });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const stdout = typeof err?.stdout === 'string' ? err.stdout : '';
    const stderr = typeof err?.stderr === 'string' ? err.stderr : '';
    if (opts.allowFailure) return { stdout, stderr, code: typeof err?.code === 'number' ? err.code : 1 };
    throw new AppError(codes.GIT_ERROR, summarizeGitError(stderr || err?.message), {
      args: finalArgs,
      code: err?.code ?? null,
    });
  }
}

/**
 * Run git with data on stdin (used for commit messages: no shell quoting, no
 * temporary files, supports multi-line bodies).
 *
 * @param {string} root
 * @param {string[]} args
 * @param {string} input
 * @param {{ timeout?: number }} [opts]
 */
export function runGitInput(root, args, input, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-c', 'core.quotepath=false', ...args], {
      cwd: root,
      env: { ...process.env, ...BASE_ENV },
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new AppError(codes.GIT_ERROR, 'git 命令超时', { args }));
    }, opts.timeout ?? 120_000);

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new AppError(codes.GIT_UNAVAILABLE, `无法执行 git: ${err.message}`, {}));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ stdout, stderr, code: code ?? 1 });
    });

    child.stdin?.end(input);
  });
}
