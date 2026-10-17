/**
 * GitHub Personal Access Token storage.
 *
 * `safeStorage` is Electron's built-in OS-backed encryption (DPAPI on Windows,
 * Keychain on macOS, libsecret/kwallet on Linux). It needs no native module
 * rebuild, which is why it is preferred over `keytar` here.
 *
 * Policy: if OS encryption is unavailable we keep the token in memory only and
 * say so in the UI. We never fall back to writing a plaintext token to disk.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { AppError, codes } from '../util/errors.js';

export class CredentialStore {
  /**
   * @param {{ userDataDir: string, safeStorage?: any }} options
   */
  constructor(options) {
    this.userDataDir = options.userDataDir;
    this.safeStorage = options.safeStorage ?? null;
    this.file = path.join(options.userDataDir, 'credentials.json');
    /** @type {string | null} */
    this.memoryToken = null;
    /** @type {{ tokenEnc?: string, username?: string, storage?: string } | null} */
    this.cache = null;
  }

  /** Can we persist an encrypted token at all? */
  encryptionAvailable() {
    try {
      return Boolean(this.safeStorage && this.safeStorage.isEncryptionAvailable());
    } catch {
      return false;
    }
  }

  async #loadFile() {
    if (this.cache) return this.cache;
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      this.cache = JSON.parse(raw.replace(/^\uFEFF/, ''));
    } catch {
      this.cache = null;
    }
    return this.cache;
  }

  /** @returns {Promise<{ hasToken: boolean, username: string, storage: 'safeStorage'|'memory'|'none' }>} */
  async status() {
    const data = await this.#loadFile();
    const hasFileToken = Boolean(data?.tokenEnc);
    return {
      hasToken: hasFileToken || Boolean(this.memoryToken),
      username: data?.username ?? '',
      storage: hasFileToken ? 'safeStorage' : this.memoryToken ? 'memory' : 'none',
    };
  }

  /**
   * @param {string} token
   * @param {string} [username]
   */
  async setToken(token, username = '') {
    const value = String(token ?? '').trim();
    if (!value) throw new AppError(codes.VALIDATION, 'Token 不能为空', {});
    if (!/^[A-Za-z0-9_]{20,}$/.test(value)) {
      throw new AppError(codes.VALIDATION, 'Token 格式不正确（GitHub PAT 通常为 40+ 位字母数字/下划线）', {});
    }

    if (!this.encryptionAvailable()) {
      this.memoryToken = value;
      return { hasToken: true, storage: 'memory', persisted: false };
    }

    const encrypted = this.safeStorage.encryptString(value).toString('base64');
    const payload = { version: 1, tokenEnc: encrypted, username: username ?? '', updatedAt: new Date().toISOString() };
    await fs.mkdir(this.userDataDir, { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 });
    this.cache = payload;
    return { hasToken: true, storage: 'safeStorage', persisted: true };
  }

  /** @returns {Promise<string | null>} */
  async getToken() {
    if (this.memoryToken) return this.memoryToken;
    const data = await this.#loadFile();
    if (!data?.tokenEnc) return null;
    if (!this.encryptionAvailable()) return null;
    try {
      return this.safeStorage.decryptString(Buffer.from(data.tokenEnc, 'base64'));
    } catch {
      throw new AppError(codes.CRYPTO_UNAVAILABLE, '无法解密已保存的 Token，请在设置中重新输入', {});
    }
  }

  async clear() {
    this.memoryToken = null;
    this.cache = null;
    await fs.rm(this.file, { force: true });
    return { hasToken: false, storage: 'none' };
  }
}
