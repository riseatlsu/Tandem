import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: process.env.VITE_BASE ?? '/FactorySim/',
  plugins: [react()],
  worker: { format: 'es' },
  // Pre-bundle the lazily imported heavy deps so the dev server never re-optimizes mid-session (504 “Outdated Optimize Dep”).
  optimizeDeps: { include: ['monaco-editor', 'blockly', 'blockly/javascript', 'three'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60000,
  },
} as never);
