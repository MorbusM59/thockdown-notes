// Minimal, standalone config for the CM6 Phase-0 spike -- deliberately NOT
// the app's own vite.config.ts (which wires up the Electron/React plugins
// this throwaway page has no use for). node_modules still resolves from
// the repo root via normal upward directory-tree resolution.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default {
  root: __dirname,
}
