/**
 * Build for the mobile soundscape app (mobile/README.md). Separate from the
 * desktop config on purpose: no Electron plugin, and its own entry, so only
 * what the soundscape panel and engine import ends up in the bundle.
 *
 * `publicDir` is the desktop app's: the soundscape worklet
 * (public/soundscape-generator.js) is one file shared by both builds.
 */
import { defineConfig } from 'vite'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { execSync } from 'node:child_process'

/** The commit this build was made from, shown in the app so an install can be told from an older one. */
const BUILD_ID = (() => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'unknown'
  }
})()

export default defineConfig({
  root: __dirname,
  base: './',
  publicDir: path.resolve(__dirname, '../public'),
  plugins: [tailwindcss(), react()],
  define: { __MOBILE_BUILD_ID__: JSON.stringify(BUILD_ID) },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
})
