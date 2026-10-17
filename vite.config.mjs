import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const rendererRoot = fileURLToPath(new URL('./src/renderer', import.meta.url));
const outDir = fileURLToPath(new URL('./dist/renderer', import.meta.url));

export default defineConfig({
  root: rendererRoot,
  base: './',
  plugins: [react()],
  build: {
    outDir,
    emptyOutDir: true,
    target: 'chrome128',
    sourcemap: false,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
