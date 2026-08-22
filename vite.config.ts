// `defineConfig` from 'vitest/config' instead of 'vite' -- it's a drop-in
// superset that additionally type-checks a `test` field, so vitest picks up
// this same file (no separate vitest.config.ts) without losing the plugins
// below (tailwind/react/electron) that a second config file would otherwise
// shadow instead of merging with.
import { defineConfig } from 'vitest/config'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const isBrowserOnlyDev = mode === 'browser'

  return {
    build: {
      // Lets the perf harness (scripts/perf/) resolve real function names
      // from a CDP JS-sampling profile of the production Electron build --
      // without this, the profiled bundle is minified with single/double-
      // letter identifiers, per docs/large-document-performance-handover.md's
      // own "concrete next steps." See perfHarness.mjs's resolveFunctionName
      // for the consuming side.
      sourcemap: true,
    },
    server: {
      watch: {
        // Packaging artifacts create massive reload noise during dev and can
        // mask real editor behavior while we tune motion/quantization.
        ignored: [
          '**/release/**',
          '**/data/**',
          '**/docs/**',
        ],
      },
    },
    test: {
      // Runs before any test file loads, no matter how vitest was invoked
      // (`npm test`, a bare `npx vitest run <file>`, an IDE runner, ...) --
      // unlike package.json's `pretest` hook, which npm only fires for `npm
      // test` itself. See the script's own doc comment for the full story.
      globalSetup: './scripts/ensureBetterSqlite3ForNode.mjs',
    },
    plugins: [
      tailwindcss(),
      react(),
      ...(isBrowserOnlyDev
        ? []
        : [
            electron({
              main: {
                // Shortcut of `build.lib.entry`.
                entry: 'electron/main.ts',
                vite: {
                  build: {
                    rollupOptions: {
                      external: ['better-sqlite3'],
                    },
                  },
                },
              },
              preload: {
                // Shortcut of `build.rollupOptions.input`.
                // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
                input: path.join(__dirname, 'electron/preload.ts'),
              },
              // Ployfill the Electron and Node.js API for Renderer process.
              // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
              // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
              renderer: process.env.NODE_ENV === 'test'
                // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
                ? undefined
                : {},
            }),
          ]),
    ],
  }
})
