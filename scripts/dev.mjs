/**
 * Dev launcher: starts the Vite dev server in-process, then spawns Electron
 * pointed at it. Using one script avoids `concurrently` and guarantees the
 * window only opens once the server is listening.
 *
 * Note: `ELECTRON_RUN_AS_NODE` is deliberately deleted from the child env —
 * some shells export it, which would make Electron run as plain Node and the
 * app would silently never show a window.
 */

import { spawn } from 'node:child_process';
import process from 'node:process';
import electronPath from 'electron';
import { createServer } from 'vite';

const server = await createServer({ configFile: 'vite.config.mjs' });
await server.listen();

const url = server.resolvedUrls?.local?.[0] ?? 'http://127.0.0.1:5173/';
console.log(`[studio] renderer dev server: ${url}`);

const env = { ...process.env, STUDIO_DEV_SERVER_URL: url };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ['.'], { stdio: 'inherit', env, windowsHide: false });

child.on('close', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    child.kill();
    await server.close();
    process.exit(0);
  });
}
