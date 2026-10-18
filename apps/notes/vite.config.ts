// `defineConfig` from 'vitest/config' instead of 'vite' -- it's a drop-in
// superset that additionally type-checks a `test` field, so vitest picks up
// this same file (no separate vitest.config.ts) without losing the plugins
// below (react/electron) that a second config file would otherwise
// shadow instead of merging with.
import { defineConfig } from 'vitest/config'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'
import { CONTENT_SECURITY_POLICY } from './contentSecurityPolicy'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const isBrowserOnlyDev = mode === 'browser'

  return {
    // The app's own folder, whichever directory Vite or Vitest is run from.
    root: __dirname,
    resolve: {
      alias: {
        // micromark's entity decoder ships TWO builds, and its `browser`
        // export condition points at the DOM one -- `index.dom.js` does
        // `document.createElement('i')` AT MODULE SCOPE and decodes `&amp;`
        // by letting the browser do it. Vite pre-bundles deps once for the
        // whole app, so a WORKER importing the markdown parser inherits that
        // resolution and dies on evaluation with "document is not defined".
        //
        // Found the hard way: the block-split worker fell back to the main
        // thread silently, its error handler retiring it exactly as designed,
        // and the freeze it existed to remove was still there. An A/B with
        // workers disabled produced the same 1.6s frozen stretch, which is
        // what gave it away.
        //
        // The package publishes a `worker` condition pointing at the pure
        // build for precisely this, but a per-worker resolution would leave
        // the rule true on one thread and not the other. Aliasing states the
        // rule once instead: THE MARKDOWN PARSER DOES NOT DEPEND ON THE DOM.
        // The pure build is a lookup table -- a few KB of entities against a
        // parser that can then run anywhere, deterministically.
        // (Installed once at the workspace root, where npm hoists it.)
        'decode-named-character-reference': path.resolve(
          __dirname,
          '../../node_modules/decode-named-character-reference/index.js',
        ),
      },
    },
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
    plugins: [
      react(),
      {
        // EVERY CODE EDIT RELOADS THE PAGE; only a stylesheet is swapped in
        // place. React Fast Refresh keeps component state across an edit by
        // re-running the edited components' effects -- it assumes an effect
        // can be torn down and set up again at any moment with nothing lost.
        // This renderer is built on the opposite assumption: its effects are
        // mount-once owners of imperative state (CM6Editor's EditorView, the
        // section's note load), and a mount is always a note load, whose
        // restore puts the caret and scroll back. A refresh broke that
        // pairing: the editor was rebuilt for the SAME note, reported its
        // fresh caret at 0 as the note's selection, and no restore followed.
        // A full reload goes through beforeunload's flush and the real
        // restore path, which is the one a reader's restart takes too.
        name: 'thockdown-full-reload-on-code-edit',
        apply: 'serve',
        handleHotUpdate({ modules, server }) {
          if (modules.length > 0 && modules.every((module) => module.type === 'css')) return undefined
          server.ws.send({ type: 'full-reload' })
          return []
        },
      },
      {
        // See contentSecurityPolicy.ts for what it allows and why.
        name: 'thockdown-content-security-policy',
        apply: 'build',
        transformIndexHtml: () => [
          { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY }, injectTo: 'head' },
        ],
      },
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
