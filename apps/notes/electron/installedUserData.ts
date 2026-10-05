import path from 'node:path'

/**
 * The folder, under the OS's per-user application-data directory (on Windows
 * `%APPDATA%`), where an installed build keeps everything it persists: its
 * notes database under `data/`, plus Electron's own settings and caches.
 *
 * Electron's default for that folder is the `name` in the packaged
 * `package.json` (electron-builder's `productName` does not reach it). That
 * coupled where a user's notes live to an npm workspace name: when the desktop
 * app moved to `apps/notes`, its package was named `thockdown-notes` instead
 * of the old root package's `thockdownnotes`, and every installed build
 * opened an empty database in a new folder beside the old one.
 *
 * The folder is therefore named here, once, and set explicitly before
 * anything resolves a path. It is a stored location, not a label: changing it
 * strands every existing install's data, exactly as that rename did.
 */
export const INSTALLED_USER_DATA_DIR_NAME = 'thockdownnotes'

export function installedUserDataPath(appDataDir: string): string {
  return path.join(appDataDir, INSTALLED_USER_DATA_DIR_NAME)
}
