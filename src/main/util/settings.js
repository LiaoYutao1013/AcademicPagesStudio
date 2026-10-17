/**
 * Small JSON settings store (repository path, recent repositories, UI state).
 * Writes go through a temp file + rename so a crash cannot truncate settings.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { writeTextFileAtomic } from '../util/fsSafe.js';

export class SettingsStore {
  /**
   * @param {string} file
   * @param {Record<string, unknown>} defaults
   */
  constructor(file, defaults = {}) {
    this.file = file;
    this.defaults = defaults;
    /** @type {Record<string, any> | null} */
    this.data = null;
  }

  async load() {
    if (this.data) return this.data;
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      // Editors on Windows may save with a UTF-8 BOM; JSON.parse rejects it.
      this.data = { ...this.defaults, ...JSON.parse(raw.replace(/^\uFEFF/, '')) };
    } catch {
      this.data = { ...this.defaults };
    }
    return this.data;
  }

  async getAll() {
    return { ...(await this.load()) };
  }

  /** @param {string} key */
  async get(key) {
    const data = await this.load();
    return data[key];
  }

  /** @param {Record<string, unknown>} patch */
  async update(patch) {
    const data = await this.load();
    const next = { ...data, ...patch };
    this.data = next;
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await writeTextFileAtomic(this.file, `${JSON.stringify(next, null, 2)}\n`);
    return { ...next };
  }
}
