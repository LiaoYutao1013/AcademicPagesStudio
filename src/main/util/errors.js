/**
 * Structured application errors.
 *
 * Every error that crosses the IPC boundary is normalised into
 * `{ code, message, details }`, so the renderer never has to parse strings.
 */

export class AppError extends Error {
  /**
   * @param {string} code stable machine-readable code, e.g. CONFIG_BLOCK_MISSING
   * @param {string} message human message (Chinese UI copy is supplied by renderer)
   * @param {Record<string, unknown>} [details]
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}

export const codes = {
  REPO_INVALID: 'REPO_INVALID',
  REPO_NOT_FOUND: 'REPO_NOT_FOUND',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  FILE_OUTSIDE_REPO: 'FILE_OUTSIDE_REPO',
  FILE_CONFLICT: 'FILE_CONFLICT',
  CONFIG_BLOCK_MISSING: 'CONFIG_BLOCK_MISSING',
  CONFIG_KEY_MISSING: 'CONFIG_KEY_MISSING',
  CONFIG_DUPLICATE_KEY: 'CONFIG_DUPLICATE_KEY',
  YAML_INVALID: 'YAML_INVALID',
  FRONT_MATTER_INVALID: 'FRONT_MATTER_INVALID',
  VALIDATION: 'VALIDATION',
  GIT_UNAVAILABLE: 'GIT_UNAVAILABLE',
  GIT_ERROR: 'GIT_ERROR',
  GIT_AUTH_MISSING: 'GIT_AUTH_MISSING',
  GIT_AUTH_FAILED: 'GIT_AUTH_FAILED',
  GIT_CONFLICT: 'GIT_CONFLICT',
  GIT_NON_FAST_FORWARD: 'GIT_NON_FAST_FORWARD',
  CRYPTO_UNAVAILABLE: 'CRYPTO_UNAVAILABLE',
  UNKNOWN: 'UNKNOWN',
};

/** Wrap any thrown value into the IPC error envelope. */
export function toIpcError(err) {
  if (err instanceof AppError) {
    return { code: err.code, message: err.message, details: err.details ?? {} };
  }
  const message = err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err);
  return { code: codes.UNKNOWN, message, details: {} };
}

/** Strip git's noisy prefix from stderr so the UI can show something useful. */
export function summarizeGitError(stderr) {
  const text = String(stderr || '').trim();
  if (!text) return 'git command failed';
  const lines = text.split(/\r?\n/).filter(Boolean);
  const interesting = lines.find((l) => /fatal|error|rejected|conflict|denied|authentication/i.test(l));
  return (interesting || lines[lines.length - 1]).trim();
}
