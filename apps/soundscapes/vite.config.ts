/**
 * Build for the mobile soundscape app (apps/soundscapes/README.md). Separate from the
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

export default defineConfig({
  root: __dirname,
  base: './',
  publicDir: path.resolve(__dirname, '../../public'),
  plugins: [tailwindcss(), react()],
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
})
