/**
 * Build for the mobile soundscape app (apps/soundscapes/README.md). Separate from the
 * desktop config on purpose: no Electron plugin, and its own entry, so only
 * what the soundscape panel and engine import ends up in the bundle.
 *
 * No `publicDir`: the soundscape worklet is imported by URL from its
 * package and bundled like any other asset.
 */
import { defineConfig } from 'vite'
import path from 'node:path'
import { thirdPartyNotices } from '../../scripts/thirdPartyNotices.mjs'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

/** What this build was made from, for the failure log (MusicDiagnostics): the commit and when it was built, in UTC. */
function buildMark(): string {
  let commit = 'unknown'
  try {
    commit = execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim()
  } catch {
    // Not a checkout: the build time alone.
  }
  return `Build ${commit}, ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

export default defineConfig({
  root: __dirname,
  base: './',
  publicDir: false,
  define: { __BUILD_MARK__: JSON.stringify(buildMark()) },
  plugins: [react(), thirdPartyNotices()],
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
})
