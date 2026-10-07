// The one lint configuration for the whole workspace (`npm run lint`, part of
// `npm run verify`). TypeScript sources only: the build and release scripts
// are plain Node JavaScript and are not linted.
import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default defineConfig([
  globalIgnores(['**/*.{js,mjs,cjs}', '**/dist', '**/dist-electron', '**/release', 'docs', 'apps/soundscapes/android']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // React Compiler's checks that this code already meets, kept so new code
      // keeps meeting them. The rest of the plugin's recommended set (refs,
      // immutability, set-state-in-effect, preserve-manual-memoization,
      // purity) is not enabled: it describes what the compiler needs, and
      // this app does not use the compiler and deliberately writes refs
      // during render (persistMenuStateNowRef in App.tsx says why).
      'react-hooks/static-components': 'error',
      'react-hooks/use-memo': 'error',
      'react-hooks/void-use-memo': 'error',
      'react-hooks/globals': 'error',
      'react-hooks/error-boundaries': 'error',
      'react-hooks/set-state-in-render': 'error',
      'react-hooks/config': 'error',
      'react-hooks/gating': 'error',
      'react-hooks/unsupported-syntax': 'error',
      'react-hooks/incompatible-library': 'error',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
])
