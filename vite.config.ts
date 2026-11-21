import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { studioPlugin } from './scripts/vite/studio-plugin';

export default defineConfig({
  base: process.env.VITE_BASE ?? '/FactorySim/',
  plugins: [react(), studioPlugin()], // studio = dev-only content editor API (?editor)
  worker: { format: 'es' },
  // keys/ holds service-account keys for Studio's code generator: never serve them, even from the dev server.
  server: { fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', 'keys/**', '**/*-firebase-adminsdk-*.json', '**/service-account*.json'] } },
  // Pre-bundle the lazily imported heavy deps so the dev server never re-optimizes mid-session (504 “Outdated Optimize Dep”).
  optimizeDeps: { include: ['monaco-editor', 'blockly', 'blockly/javascript', 'three', 'three/examples/jsm/loaders/GLTFLoader.js', 'three/examples/jsm/loaders/OBJLoader.js', 'three/examples/jsm/loaders/STLLoader.js', 'three/examples/jsm/loaders/ColladaLoader.js'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60000,
  },
} as never);
