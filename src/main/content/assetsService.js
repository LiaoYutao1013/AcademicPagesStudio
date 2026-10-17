/**
 * Asset import: drag-and-drop images and files into `images/` / `files/`.
 *
 * Academic Pages resolves a bare `author.avatar` name against `/images/`, and
 * `header.teaser` the same way, so uploads must land in `images/` and be
 * referenced by file name — not by an absolute OS path.
 *
 * When the site sets `baseurl`, a hard-coded `/images/x.png` breaks on GitHub
 * Pages project sites, so the generated Markdown uses Liquid's `relative_url`
 * in that case.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { AppError, codes } from '../util/errors.js';
import { exists, resolveInside, uniqueFileName, writeBinaryFileAtomic } from '../util/fsSafe.js';
import { slugify } from '../util/text.js';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif']);
const FILE_EXTENSIONS = new Set([
  '.pdf', '.zip', '.7z', '.bib', '.tex', '.csv', '.xlsx', '.docx', '.pptx', '.md', '.txt', '.ipynb', '.json',
]);
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Sanitise an uploaded file name: ASCII, no separators, no leading dot.
 * @param {string} input
 */
export function sanitizeAssetName(input) {
  const base = path.basename(String(input || 'asset'));
  const ext = path.extname(base).toLowerCase();
  const stem = slugify(path.basename(base, path.extname(base))) || 'asset';
  const safeExt = /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : '';
  return `${stem.slice(0, 80)}${safeExt}`;
}

/**
 * @param {{ baseurl?: string }} config
 * @param {'images'|'files'} kind
 * @param {string} name
 */
export function assetUrl(config, kind, name) {
  const plain = `/${kind}/${name}`;
  const baseurl = String(config?.baseurl ?? '').trim();
  if (!baseurl) return plain;
  return `{{ '${plain}' | relative_url }}`;
}

/**
 * Write an asset into the repository and produce the Markdown to insert.
 *
 * @param {string} root
 * @param {{
 *   sourcePath?: string,
 *   dataBase64?: string,
 *   fileName?: string,
 *   alt?: string,
 *   kind?: 'auto'|'image'|'file',
 *   config: Record<string, any>,
 * }} input
 */
export async function importAsset(root, input) {
  const sourcePath = input.sourcePath ? path.resolve(input.sourcePath) : null;
  const originalName = input.fileName || (sourcePath ? path.basename(sourcePath) : 'asset');
  const name = sanitizeAssetName(originalName);
  const ext = path.extname(name).toLowerCase();

  if (ext && !IMAGE_EXTENSIONS.has(ext) && !FILE_EXTENSIONS.has(ext)) {
    throw new AppError(codes.VALIDATION, `不支持的文件类型: ${ext || '(无扩展名)'}`, { name });
  }

  const kind = input.kind && input.kind !== 'auto'
    ? input.kind
    : IMAGE_EXTENSIONS.has(ext) ? 'image' : 'file';

  const dirName = kind === 'image' ? 'images' : 'files';
  const dirAbs = resolveInside(root, dirName);
  await fs.mkdir(dirAbs, { recursive: true });

  let bytes;
  if (sourcePath) {
    const stat = await fs.stat(sourcePath).catch(() => null);
    if (!stat || !stat.isFile()) {
      throw new AppError(codes.FILE_NOT_FOUND, `源文件不存在: ${sourcePath}`, { sourcePath });
    }
    if (stat.size > MAX_BYTES) {
      throw new AppError(codes.VALIDATION, `文件超过 ${MAX_BYTES / 1024 / 1024}MB`, { size: stat.size });
    }
    bytes = await fs.readFile(sourcePath);
  } else if (input.dataBase64) {
    bytes = Buffer.from(input.dataBase64, 'base64');
    if (bytes.length > MAX_BYTES) {
      throw new AppError(codes.VALIDATION, `文件超过 ${MAX_BYTES / 1024 / 1024}MB`, { size: bytes.length });
    }
  } else {
    throw new AppError(codes.VALIDATION, '缺少文件内容（sourcePath 或 dataBase64）');
  }

  const finalName = await uniqueFileName(dirAbs, name);
  const abs = path.join(dirAbs, finalName);
  if (await exists(abs)) {
    throw new AppError(codes.FILE_CONFLICT, `资源已存在: ${dirName}/${finalName}`, { name: finalName });
  }
  await writeBinaryFileAtomic(abs, bytes);

  const url = assetUrl(input.config ?? {}, dirName, finalName);
  const alt = String(input.alt ?? '').trim() || path.basename(finalName, path.extname(finalName));
  const markdown = kind === 'image' ? `![${alt}](${url})` : `[${alt}](${url})`;

  return {
    kind,
    name: finalName,
    repoPath: `${dirName}/${finalName}`,
    url,
    plainUrl: `/${dirName}/${finalName}`,
    markdown,
    bytes: bytes.length,
  };
}

/**
 * Avatar upload: same as `importAsset`, but the caller needs only the file
 * name because `_config.yml` → `author.avatar` is a name under `images/`.
 *
 * @param {string} root
 * @param {{ sourcePath?: string, dataBase64?: string, fileName?: string, config: Record<string, any> }} input
 */
export async function importAvatar(root, input) {
  const asset = await importAsset(root, { ...input, kind: 'image' });
  return { name: asset.name, repoPath: asset.repoPath, plainUrl: asset.plainUrl };
}
