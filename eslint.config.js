import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['dist/**', 'vendor/**', 'node_modules/**', 'tests/fixtures/**'],
  },
  js.configs.recommended,

  // Extension source: browser plus the chrome.* extension APIs.
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.webextensions,
      },
    },
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'smart'],
    },
  },

  // Build and release tooling runs under Node.
  {
    files: ['scripts/**/*.mjs', 'eslint.config.js', 'vitest.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: globals.node,
    },
  },

  // Tests import their helpers from vitest explicitly, so no test globals here.
  // jsdom-environment files need browser globals; node-environment ones need Node.
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
];
