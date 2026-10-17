/**
 * Electron main process: window lifecycle, security policy, IPC wiring.
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, Menu, safeStorage, session, shell } from 'electron';

import { registerIpcHandlers } from './ipc/handlers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_URL = process.env.STUDIO_DEV_SERVER_URL ?? null;

app.setName('Academic Pages Studio');

/** @type {BrowserWindow | null} */
let mainWindow = null;

function buildMenu() {
  /** @type {import('electron').MenuItemConstructorOptions[]} */
  const template = [
    {
      label: '文件',
      submenu: [
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    backgroundColor: '#0e1015',
    title: 'Academic Pages Studio',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => { mainWindow = null; });

  // Never let a stray link navigate the app shell; open it in the browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = DEV_URL ? url.startsWith(DEV_URL) : url.startsWith('file://');
    if (!allowed) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  if (DEV_URL) {
    mainWindow.loadURL(DEV_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'renderer', 'index.html'));
  }

  // Headless start-up check: `STUDIO_SMOKE=1 electron .` boots the real app,
  // waits for the renderer, then exits. Used to verify preload/IPC wiring in CI
  // without leaving a window open.
  if (process.env.STUDIO_SMOKE === '1') {
    console.log(`[smoke] userData = ${app.getPath('userData')}`);
    mainWindow.webContents.on('console-message', (_event, level, message) => {
      console.log(`[renderer:${level}] ${message}`);
    });
    mainWindow.webContents.on('did-finish-load', async () => {
      try {
        const children = await mainWindow.webContents.executeJavaScript(
          'document.getElementById("root")?.childElementCount ?? 0',
        );
        console.log(`[smoke] renderer loaded, #root children = ${children}`);
        if (!children) console.error('[smoke] React did not mount — check CSP, preload or build output');
        const probe = await mainWindow.webContents.executeJavaScript(`(async () => {
          try {
            const info = await window.studio.workspace.init();
            if (!info.repoPath) return { step: 'init', repoPath: null, token: info.token };
            try {
              const opened = await window.studio.workspace.open(info.repoPath);
              return { step: 'opened', root: opened.root, types: opened.contentTypes.length, counts: opened.counts };
            } catch (err) {
              return { step: 'open-failed', code: err.code, message: err.message, details: err.details };
            }
          } catch (err) {
            return { step: 'init-failed', code: err.code, message: err.message };
          }
        })()`);
        console.log(`[smoke] workspace probe: ${JSON.stringify(probe)}`);
        if (process.env.STUDIO_SMOKE_SHOT) {
          if (process.env.STUDIO_SMOKE_OPEN_FIRST === '1') {
            const clicked = await mainWindow.webContents.executeJavaScript(
              `(() => { const el = document.querySelector('.doc-item'); if (!el) return false; el.click(); return true; })()`,
            );
            console.log(`[smoke] opened first document: ${clicked}`);
            await new Promise((resolve) => setTimeout(resolve, 1500));
          }
          if (process.env.STUDIO_SMOKE_CLICK) {
            const label = JSON.stringify(process.env.STUDIO_SMOKE_CLICK);
            const clicked = await mainWindow.webContents.executeJavaScript(
              `(() => {
                const buttons = [...document.querySelectorAll('button, a')];
                const target = buttons.find((el) => el.textContent.trim().includes(${label}));
                if (!target) return false;
                target.click();
                return true;
              })()`,
            );
            console.log(`[smoke] clicked "${process.env.STUDIO_SMOKE_CLICK}": ${clicked}`);
            await new Promise((resolve) => setTimeout(resolve, 1600));
          }
          await new Promise((resolve) => setTimeout(resolve, 1200));
          const image = await mainWindow.webContents.capturePage();
          await fs.writeFile(process.env.STUDIO_SMOKE_SHOT, image.toPNG());
          console.log(`[smoke] screenshot saved to ${process.env.STUDIO_SMOKE_SHOT}`);
        }
      } catch (err) {
        console.error(`[smoke] probe failed: ${err.message}`);
      }
      setTimeout(() => app.quit(), 500);
    });
    mainWindow.webContents.on('did-fail-load', (_event, code, description) => {
      console.error(`[smoke] renderer failed to load: ${code} ${description}`);
    });
    mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
      console.error(`[smoke] preload error in ${preloadPath}: ${error.message}`);
    });
  }
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    // The app needs no camera/mic/notifications; deny everything by default.
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

    registerIpcHandlers({
      userDataDir: app.getPath('userData'),
      safeStorage,
    });

    buildMenu();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
