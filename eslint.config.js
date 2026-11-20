import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'functions/lib', 'functions/node_modules', 'test-results', 'playwright-report', 'exports', 'public/models', 'tests/fixtures/solutions'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
    },
  },
  {
    // SimCore must stay pure, headless and deterministic (SPEC §2, §6.1)
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['three', 'three/*', 'react', 'react-dom', 'blockly', 'monaco-editor', '../view/*', '../store', '../store/*', '../simHost'], message: 'src/sim must not depend on rendering/UI code.' }] }],
      'no-restricted-properties': ['error', { object: 'Math', property: 'random', message: 'Use the seeded rng in src/sim/rng.ts.' }],
      'no-restricted-globals': ['error', 'window', 'document', 'performance', 'Date'],
    },
  },
);
