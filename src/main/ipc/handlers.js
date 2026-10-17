/**
 * IPC surface. One handler per channel, every result wrapped in
 * `{ ok, data } | { ok: false, error }` so the preload bridge can re-throw a
 * structured error instead of leaking Electron internals to the renderer.
 *
 * Responsibilities live here (main process): filesystem, YAML, git, secrets.
 * The renderer only ever sees plain JSON.
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron';

import { AppError, codes, toIpcError } from '../util/errors.js';
import { resolveInside, writeTextFileAtomic } from '../util/fsSafe.js';
import { diffLines } from '../util/lineDiff.js';
import { SettingsStore } from '../util/settings.js';
import { CredentialStore } from '../security/credentialStore.js';
import {
  assertRepository,
  detectContentDirs,
  readNavigationText,
  readSiteConfig,
} from '../config/siteConfig.js';
import { AUTHOR_FIELDS, AUTHOR_GROUPS, readAuthor, updateAuthor } from '../config/authorService.js';
import { normalizeItems, parseNavigation, updateNavigation } from '../config/navigationService.js';
import {
  applyCollectionPlan,
  checkPlan,
  planCollection,
  previewCollection,
} from '../config/collectionsService.js';
import {
  createDocument,
  deleteDocument,
  listDocuments,
  publishDraft,
  readDocument,
  renameDocument,
  saveDocument,
  suggestPath,
} from '../content/contentService.js';
import { listContentTypes, inheritedDefaults, resolveTypeSpec } from '../content/templates.js';
import { importAsset, importAvatar } from '../content/assetsService.js';
import * as git from '../git/gitService.js';
import { isGitAvailable } from '../git/gitRunner.js';

/** @type {{ repoPath: string | null }} */
const state = { repoPath: null };

/**
 * @param {import('electron').IpcMainInvokeEvent} event
 * @param {string} channel
 * @param {() => Promise<unknown>} fn
 */
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, payload) => {
    try {
      return { ok: true, data: await fn(payload, event) };
    } catch (err) {
      if (!(err instanceof AppError)) console.error(`[ipc:${channel}]`, err);
      return { ok: false, error: toIpcError(err) };
    }
  });
}

function requireRepo() {
  if (!state.repoPath) {
    throw new AppError(codes.REPO_NOT_FOUND, '尚未打开博客仓库', {});
  }
  return state.repoPath;
}

async function loadConfig() {
  return readSiteConfig(requireRepo());
}

/** Config subset the renderer needs (never the whole 361-line file). */
function configView(config) {
  return {
    title: config.title,
    description: config.description,
    url: config.url,
    baseurl: config.baseurl,
    locale: config.locale,
    repository: config.repository,
    author: config.author,
    collections: config.collections,
    defaults: config.defaults,
    publicationCategories: config.publicationCategories,
  };
}

/** @param {string} relPath @param {string} before @param {string} after */
function filePreview(relPath, before, after) {
  return { path: relPath, action: before ? 'update' : 'create', before, after, diff: diffLines(before, after) };
}

/**
 * @param {{ userDataDir: string, safeStorage: any }} options
 */
export function registerIpcHandlers(options) {
  const settings = new SettingsStore(path.join(options.userDataDir, 'settings.json'), {
    repoPath: null,
    recentRepos: [],
    lastDocPath: null,
  });
  const credentials = new CredentialStore({ userDataDir: options.userDataDir, safeStorage: options.safeStorage });

  // ---------------------------------------------------------------- workspace

  handle('workspace:init', async () => {
    const all = await settings.getAll();
    const saved = all.repoPath ? String(all.repoPath) : null;
    let valid = false;
    if (saved) {
      valid = await assertRepository(saved).then(() => true).catch(() => false);
      if (valid) state.repoPath = saved;
      else state.repoPath = null;
    }
    return {
      repoPath: valid ? saved : null,
      recentRepos: Array.isArray(all.recentRepos) ? all.recentRepos : [],
      token: await credentials.status(),
      encryptionAvailable: credentials.encryptionAvailable(),
      gitAvailable: await isGitAvailable(),
      contentDirs: valid ? await detectContentDirs(saved) : {},
    };
  });

  handle('workspace:choose', async () => {
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win ?? undefined, {
      title: '选择 Academic Pages 博客仓库',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };
    return { canceled: false, repoPath: result.filePaths[0] };
  });

  handle('workspace:open', async (payload) => {
    const repoPath = String(payload?.repoPath ?? '').trim();
    if (!repoPath) throw new AppError(codes.REPO_NOT_FOUND, '缺少仓库路径', {});

    await assertRepository(repoPath);
    const config = await readSiteConfig(repoPath);
    state.repoPath = config.configPath ? path.dirname(config.configPath) : repoPath;

    const all = await settings.getAll();
    const recent = [state.repoPath, ...(all.recentRepos ?? []).filter((p) => p !== state.repoPath)].slice(0, 8);
    await settings.update({ repoPath: state.repoPath, recentRepos: recent });

    let gitState = null;
    let gitError = null;
    try {
      gitState = await git.getStatus(state.repoPath);
      if (!gitState.upstream) gitState.upstream = null;
    } catch (err) {
      gitError = err instanceof AppError ? { code: err.code, message: err.message } : { code: codes.UNKNOWN, message: String(err) };
    }

    const contentDirs = await detectContentDirs(state.repoPath);
    const counts = {
      posts: await countFiles(state.repoPath, '_posts'),
      drafts: await countFiles(state.repoPath, '_drafts'),
      pages: await countFiles(state.repoPath, '_pages'),
    };
    for (const collection of config.collections) {
      counts[collection.label] = await countFiles(state.repoPath, `_${collection.label}`);
    }

    return {
      root: state.repoPath,
      name: path.basename(state.repoPath),
      site: configView(config),
      contentTypes: listContentTypes(config),
      contentDirs,
      counts,
      git: gitState,
      gitError,
      token: await credentials.status(),
    };
  });

  handle('workspace:forget', async () => {
    state.repoPath = null;
    await settings.update({ repoPath: null });
    return { ok: true };
  });

  // ---------------------------------------------------------------- profile

  handle('config:author:get', async () => {
    const config = await loadConfig();
    const { values, extras } = readAuthor(config.raw);
    return { fields: AUTHOR_FIELDS, groups: AUTHOR_GROUPS, values, extras };
  });

  handle('config:author:preview', async (payload) => {
    const config = await loadConfig();
    const patch = payload?.values ?? {};
    const result = updateAuthor(config.raw, patch);
    const rel = '_config.yml';
    const files = result.text === config.raw ? [] : [filePreview(rel, config.raw, result.text)];
    return { files, warnings: result.warnings, changedKeys: result.changedKeys };
  });

  handle('config:author:apply', async (payload) => {
    const config = await loadConfig();
    const result = updateAuthor(config.raw, payload?.values ?? {});
    if (result.text !== config.raw) {
      const abs = resolveInside(requireRepo(), '_config.yml');
      await writeTextFileAtomic(abs, result.text);
    }
    return {
      files: [filePreview('_config.yml', config.raw, result.text)],
      warnings: result.warnings,
      changedKeys: result.changedKeys,
      path: '_config.yml',
    };
  });

  // ------------------------------------------------------------- navigation

  handle('nav:get', async () => {
    const text = await readNavigationText(requireRepo());
    const { items, blankBetween } = parseNavigation(text);
    return { items, blankBetween };
  });

  handle('nav:preview', async (payload) => {
    const text = await readNavigationText(requireRepo());
    const result = updateNavigation(text, payload?.items ?? []);
    return {
      files: result.text === text ? [] : [filePreview('_data/navigation.yml', text, result.text)],
      warnings: result.warnings,
      items: result.items,
    };
  });

  handle('nav:apply', async (payload) => {
    const text = await readNavigationText(requireRepo());
    const result = updateNavigation(text, payload?.items ?? []);
    if (result.text !== text) {
      const abs = resolveInside(requireRepo(), '_data/navigation.yml');
      const { writeTextFileAtomic } = await import('../util/fsSafe.js');
      await writeTextFileAtomic(abs, result.text);
    }
    return {
      files: [filePreview('_data/navigation.yml', text, result.text)],
      warnings: result.warnings,
      items: result.items,
    };
  });

  // -------------------------------------------------------------- collections

  handle('collection:preview', async (payload) => {
    const plan = planCollection(payload ?? {});
    const preview = await previewCollection(requireRepo(), plan);
    return {
      plan,
      errors: preview.errors,
      warnings: preview.warnings,
      files: preview.files.map((file) => ({
        ...file,
        diff: diffLines(file.before, file.after),
      })),
    };
  });

  handle('collection:apply', async (payload) => {
    const plan = planCollection(payload ?? {});
    const result = await applyCollectionPlan(requireRepo(), plan);
    return { plan, paths: result.paths };
  });

  handle('collection:check', async (payload) => {
    const plan = planCollection(payload ?? {});
    return checkPlan(requireRepo(), plan);
  });

  // -------------------------------------------------------------------- docs

  handle('doc:list', async (payload) => {
    const config = await loadConfig();
    const docs = await listDocuments(requireRepo(), { typeId: payload?.typeId, config });
    return { docs, types: listContentTypes(config), config: configView(config) };
  });

  handle('doc:read', async (payload) => {
    const config = await loadConfig();
    const doc = await readDocument(requireRepo(), String(payload?.path ?? ''), config);
    const typeId = doc.typeId;
    const spec = typeId ? resolveTypeSpec(config, typeId) : null;
    return {
      ...doc,
      spec,
      inherited: spec ? inheritedDefaults(config, spec) : {},
      types: listContentTypes(config),
    };
  });

  handle('doc:create', async (payload) => {
    const config = await loadConfig();
    const doc = await createDocument(requireRepo(), {
      typeId: payload?.typeId,
      title: payload?.title,
      slug: payload?.slug,
      date: payload?.date,
      draft: payload?.draft,
      values: payload?.values,
      body: payload?.body,
      config,
    });
    return { doc, types: listContentTypes(config) };
  });

  handle('doc:save', async (payload) => {
    const config = await loadConfig();
    const doc = await saveDocument(requireRepo(), {
      path: payload?.path,
      values: payload?.values,
      body: payload?.body ?? '',
      frontMatterText: payload?.frontMatterText,
      expectedMtimeMs: payload?.expectedMtimeMs,
      config,
    });
    return { doc };
  });

  handle('doc:rename', async (payload) => {
    const config = await loadConfig();
    const doc = await renameDocument(requireRepo(), {
      path: payload?.path,
      slug: payload?.slug,
      date: payload?.date,
      config,
    });
    return { doc };
  });

  handle('doc:delete', async (payload) => {
    const result = await deleteDocument(requireRepo(), payload?.path, (abs) => shell.trashItem(abs));
    return result;
  });

  handle('doc:publish', async (payload) => {
    const config = await loadConfig();
    const doc = await publishDraft(requireRepo(), {
      path: payload?.path,
      date: payload?.date,
      slug: payload?.slug,
      config,
    });
    return { doc };
  });

  handle('doc:suggestPath', async (payload) => {
    const config = await loadConfig();
    return suggestPath(requireRepo(), {
      typeId: payload?.typeId,
      title: payload?.title ?? '',
      date: payload?.date,
      draft: payload?.draft,
      config,
    });
  });

  // ------------------------------------------------------------------ assets

  handle('asset:import', async (payload) => {
    const config = await loadConfig();
    return importAsset(requireRepo(), {
      sourcePath: payload?.sourcePath,
      dataBase64: payload?.dataBase64,
      fileName: payload?.fileName,
      alt: payload?.alt,
      kind: payload?.kind,
      config,
    });
  });

  handle('asset:avatar', async (payload) => {
    const config = await loadConfig();
    return importAvatar(requireRepo(), {
      sourcePath: payload?.sourcePath,
      dataBase64: payload?.dataBase64,
      fileName: payload?.fileName,
      config,
    });
  });

  handle('dialog:pickFile', async (payload) => {
    const kind = payload?.kind === 'image' ? 'image' : 'any';
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win ?? undefined, {
      title: kind === 'image' ? '选择图片' : '选择文件',
      properties: ['openFile'],
      filters: kind === 'image'
        ? [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'] }]
        : [{ name: '所有文件', extensions: ['*'] }],
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };
    return { canceled: false, sourcePath: result.filePaths[0], fileName: path.basename(result.filePaths[0]) };
  });

  handle('app:reveal', async (payload) => {
    const abs = resolveInside(requireRepo(), String(payload?.path ?? ''));
    shell.showItemInFolder(abs);
    return { ok: true, path: abs };
  });

  // --------------------------------------------------------------------- git

  handle('git:status', async () => git.getStatus(requireRepo()));

  handle('git:diff', async (payload) => git.getDiff(requireRepo(), { paths: payload?.paths, staged: payload?.staged }));

  handle('git:log', async (payload) => git.getLog(requireRepo(), payload?.limit ?? 20));

  handle('git:commit', async (payload) => git.commit(requireRepo(), {
    message: payload?.message,
    paths: payload?.paths,
  }));

  handle('git:push', async (payload, event) => {
    const token = await credentials.getToken();
    return git.push(requireRepo(), {
      token,
      onProgress: (message) => safeSend(event, 'git:progress', { stage: 'push', message }),
    });
  });

  handle('git:pull', async () => {
    const token = await credentials.getToken();
    await git.fetchRemote(requireRepo(), { token });
    return git.rebaseOntoUpstream(requireRepo());
  });

  handle('git:sync', async (payload, event) => {
    const token = await credentials.getToken();
    const result = await git.sync(requireRepo(), {
      message: payload?.message || defaultCommitMessage(),
      pull: payload?.pull !== false,
      token,
      onProgress: (stage, message) => safeSend(event, 'git:progress', { stage, message }),
    });
    return { ...result, config: configView(await loadConfig()) };
  });

  // ------------------------------------------------------------------ secrets

  handle('secret:status', async () => ({
    ...(await credentials.status()),
    encryptionAvailable: credentials.encryptionAvailable(),
  }));

  handle('secret:set', async (payload) => credentials.setToken(payload?.token, payload?.username));

  handle('secret:clear', async () => credentials.clear());

  // ---------------------------------------------------------------------- app

  handle('app:info', async () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    userData: options.userDataDir,
    repoPath: state.repoPath,
  }));

  handle('app:openExternal', async (payload) => {
    const url = String(payload?.url ?? '');
    if (!/^https?:\/\//i.test(url)) throw new AppError(codes.VALIDATION, '只允许打开 http(s) 链接', { url });
    await shell.openExternal(url);
    return { ok: true };
  });

  handle('window:state', async () => ({ repoPath: state.repoPath }));

  return { settings, credentials, state };
}

/** @param {any} event @param {string} channel @param {any} payload */
function safeSend(event, channel, payload) {
  try {
    if (event?.sender && !event.sender.isDestroyed()) event.sender.send(channel, payload);
  } catch {
    // window closed mid-operation
  }
}

async function countFiles(root, dir) {
  try {
    const entries = await fs.readdir(path.join(root, dir));
    return entries.filter((name) => /\.(md|markdown|html)$/i.test(name)).length;
  } catch {
    return 0;
  }
}

function defaultCommitMessage() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `Update content from Academic Pages Studio (${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())})`;
}
