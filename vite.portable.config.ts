import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Portable offline build: everything in one chunk, worker inlined as a Blob
 * (file:// pages cannot load worker files, but Blob workers are allowed).
 * scripts/build-portable.mjs runs this config, then folds the emitted JS+CSS
 * into a single self-contained conductvac.html you can email and double-click.
 */
export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'iife' },
  resolve: {
    alias: [
      {
        find: /^\.\/engine\/workerCtor$/,
        replacement: fileURLToPath(new URL('./src/engine/workerCtor.portable.ts', import.meta.url)),
      },
    ],
  },
  build: {
    outDir: 'dist-portable',
    // one chunk, no preload helper indirection — everything gets inlined anyway
    modulePreload: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
} as any);
