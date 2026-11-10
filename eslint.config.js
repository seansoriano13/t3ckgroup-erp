import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'
import noPrimaryDecoration from './src/lib/linting/no-primary-decoration.js'
import noRawHtml, { DISABLE_MESSAGE as NO_RAW_HTML_DISABLE, isExempt as isSharedUi } from './src/lib/linting/no-raw-html.js'
import noIsoDateSlice from './src/lib/linting/no-iso-date-slice.js'
import requirePageShell, { DISABLE_MESSAGE as PAGE_SHELL_DISABLE } from './src/lib/linting/require-page-shell.js'
import { createRefuseDisableProcessor } from './src/lib/linting/refuse-disable.js'

// Neither guard rule can be switched off inline in feature code.
const refuseDisableProcessor = createRefuseDisableProcessor(
  {
    'no-raw-html': NO_RAW_HTML_DISABLE,
    'require-page-shell': PAGE_SHELL_DISABLE,
  },
  isSharedUi,
)

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
          'no-iso-date-slice': noIsoDateSlice,
          'require-page-shell': requirePageShell,
        },
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^[A-Z_]' }],
      'local/no-primary-decoration': 'warn',
    },
  },
  {
    // ADR 0025: raw covered HTML is banned in feature code. ADR 0029: every
    // routed Page renders through PageShell. The shared UI folder is exempt
    // inside each rule, by path. There is no baseline.
    files: ['src/**/*.{js,jsx}'],
    ignores: ['src/test/**', 'src/**/*.test.{js,jsx}'],
    processor: refuseDisableProcessor,
    rules: {
      'local/no-raw-html': 'error',
      // ADR 0039: dates are Manila dates; use src/lib/manilaDate.js.
      'local/no-iso-date-slice': 'error',
      'local/require-page-shell': 'error',
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
