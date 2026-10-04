/**
 * Builds the soundscape renderer (packages/soundscape/soundscapeSandbox.ts) as one
 * self-contained IIFE into the Android app's assets, where the native
 * service loads it into a JavaScriptSandbox (SoundscapeRenderer.java).
 * Generated; not committed (android/.gitignore).
 */
import { defineConfig } from 'vite'
import path from 'node:path'

export default defineConfig({
  // Only the bundle: the app's public/ belongs to the web build.
  publicDir: false,
  build: {
    outDir: path.resolve(__dirname, 'android/app/src/main/assets'),
    emptyOutDir: false,
    lib: {
      entry: path.resolve(__dirname, '../../packages/soundscape/soundscapeSandbox.ts'),
      formats: ['iife'],
      name: 'SoundscapeRenderer',
      fileName: () => 'soundscape-renderer.js',
    },
  },
})
