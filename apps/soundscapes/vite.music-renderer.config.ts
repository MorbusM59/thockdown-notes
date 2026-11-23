/**
 * Builds the music renderer (src/musicSandbox.ts) as one self-contained IIFE
 * into the Android app's assets, where the native service loads it into a
 * JavaScriptSandbox (MusicRenderer.java), beside the soundscape's
 * (vite.renderer.config.ts). Generated; not committed (android/.gitignore).
 */
import { defineConfig } from 'vite'
import path from 'node:path'
import { thirdPartyNotices } from '../../scripts/thirdPartyNotices.mjs'

export default defineConfig({
  publicDir: false,
  plugins: [thirdPartyNotices()],
  build: {
    outDir: path.resolve(__dirname, 'android/app/src/main/assets'),
    emptyOutDir: false,
    lib: {
      entry: path.resolve(__dirname, 'src/musicSandbox.ts'),
      formats: ['iife'],
      name: 'MusicRenderer',
      fileName: () => 'music-renderer.js',
    },
  },
})
