/**
 * Preload bridge.
 *
 * Runs sandboxed (`sandbox: true`), so this file is CommonJS and only touches
 * the `electron` module. The renderer gets a narrow, typed surface — never
 * `ipcRenderer`, never Node, never the token.
 */

const { contextBridge, ipcRenderer, webUtils } = require('electron');

/**
 * @param {string} channel
 * @param {unknown} [payload]
 */
async function call(channel, payload) {
  const response = await ipcRenderer.invoke(channel, payload);
  if (!response || response.ok !== true) {
    const error = new Error(response?.error?.message ?? '未知错误');
    error.code = response?.error?.code ?? 'UNKNOWN';
    error.details = response?.error?.details ?? {};
    throw error;
  }
  return response.data;
}

contextBridge.exposeInMainWorld('studio', {
  workspace: {
    init: () => call('workspace:init'),
    choose: () => call('workspace:choose'),
    open: (repoPath) => call('workspace:open', { repoPath }),
    forget: () => call('workspace:forget'),
  },

  profile: {
    get: () => call('config:author:get'),
    preview: (values) => call('config:author:preview', { values }),
    apply: (values) => call('config:author:apply', { values }),
  },

  nav: {
    get: () => call('nav:get'),
    preview: (items) => call('nav:preview', { items }),
    apply: (items) => call('nav:apply', { items }),
  },

  collections: {
    check: (input) => call('collection:check', input),
    preview: (input) => call('collection:preview', input),
    apply: (input) => call('collection:apply', input),
  },

  docs: {
    list: (typeId) => call('doc:list', { typeId }),
    read: (docPath) => call('doc:read', { path: docPath }),
    create: (input) => call('doc:create', input),
    save: (input) => call('doc:save', input),
    rename: (input) => call('doc:rename', input),
    remove: (docPath) => call('doc:delete', { path: docPath }),
    publish: (input) => call('doc:publish', input),
    suggestPath: (input) => call('doc:suggestPath', input),
  },

  assets: {
    import: (input) => call('asset:import', input),
    avatar: (input) => call('asset:avatar', input),
    pick: (kind) => call('dialog:pickFile', { kind }),
    /** Electron 32+ removed `File.path`; this is the supported replacement. */
    pathForFile: (file) => {
      try {
        return webUtils.getPathForFile(file);
      } catch {
        return '';
      }
    },
  },

  git: {
    status: () => call('git:status'),
    diff: (paths) => call('git:diff', { paths }),
    log: (limit) => call('git:log', { limit }),
    commit: (message, paths) => call('git:commit', { message, paths }),
    push: () => call('git:push'),
    pull: () => call('git:pull'),
    sync: (input) => call('git:sync', input),
  },

  secrets: {
    status: () => call('secret:status'),
    set: (token, username) => call('secret:set', { token, username }),
    clear: () => call('secret:clear'),
  },

  app: {
    info: () => call('app:info'),
    openExternal: (url) => call('app:openExternal', { url }),
    reveal: (docPath) => call('app:reveal', { path: docPath }),
  },

  /** @returns {() => void} unsubscribe */
  onGitProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('git:progress', listener);
    return () => ipcRenderer.removeListener('git:progress', listener);
  },
});
