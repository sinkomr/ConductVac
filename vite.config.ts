import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' makes the build relocatable so it works on GitHub Pages project sites
export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60000,
  },
} as any);
