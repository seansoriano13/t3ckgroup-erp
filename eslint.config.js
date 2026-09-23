import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'
import noPrimaryDecoration from './src/lib/linting/no-primary-decoration.js'
import noRawHtml, { refuseDisableProcessor } from './src/lib/linting/no-raw-html.js'

export default defineConfig([
  globalIgnores(['dist/**', '.claude/**', '.gemini/**', '.github/**']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.browser,
        __APP_VERSION__: 'readonly',
        __APP_SEMVER__: 'readonly',
        __BUILD_TIME__: 'readonly',
      },
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: {
      local: {
        rules: {
          'no-primary-decoration': noPrimaryDecoration,
          'no-raw-html': noRawHtml,
        },
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^[A-Z_]' }],
      'local/no-primary-decoration': 'warn',
    },
  },
  {
    // ADR 0025: raw covered HTML is banned in feature code. The shared UI folder
    // is exempt inside the rule itself, by path. Existing violations are frozen
    // in eslint-suppressions.json; only new ones fail.
    files: ['src/**/*.{js,jsx}'],
    ignores: ['src/test/**', 'src/**/*.test.{js,jsx}'],
    processor: refuseDisableProcessor,
    rules: {
      'local/no-raw-html': 'error',
    },
  },
  {
    // Standalone maintenance scripts. These are run with `node`, never bundled,
    // so they get Node's globals and none of the Fast Refresh rules.
    files: ['*.{js,mjs}', 'scripts/**/*.{js,mjs}'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    // Tests and the test harness. They run in Node (the harness reads the SQL
    // schema off disk), and the Fast Refresh rule does not apply to files that
    // are never part of a bundle.
    files: ['src/test/**/*.{js,jsx}', '**/*.test.{js,jsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
