import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Point at the adapter's browser-safe source so dev, build and tests never need a prior adapter build.
const adapterCore = fileURLToPath(new URL('../adapter/src/core.ts', import.meta.url));

export default defineConfig({
  base: './',
  resolve: {
    alias: { '@bellwether/adapter/core': adapterCore },
  },
  server: {
    port: 5173,
    fs: { allow: ['../..'] },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: 'node',
  },
});
