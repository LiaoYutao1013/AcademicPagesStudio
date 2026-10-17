/**
 * Production launcher.
 *
 * Same reason as `dev.mjs`: remove `ELECTRON_RUN_AS_NODE` from the child env.
 * When that variable is inherited (some CI shells export it), `electron .`
 * would run as plain Node, print nothing useful and exit without a window.
 */

import { spawn } from 'node:child_process';
import process from 'node:process';
import electronPath from 'electron';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ['.'], { stdio: 'inherit', env, windowsHide: false });
child.on('close', (code) => process.exit(code ?? 0));
