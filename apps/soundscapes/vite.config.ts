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
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: __dirname,
  base: './',
  publicDir: false,
  plugins: [tailwindcss(), react()],
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
})
