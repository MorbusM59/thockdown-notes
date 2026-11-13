// verify: reads-temp (scripts/verify.mjs, "what a module reads from disk")
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { hasImageExtension } from '../src/shared/images'

/**
 * The image files among files and folders dropped from the file manager on
 * the Images view, each with the folders it was found in, from the dropped
 * folder down to the one holding it (empty for a file dropped on its own),
 * which is what `imageTagsFromFolders` tags it from. A folder is searched
 * through; a path or folder that cannot be read is skipped; only names with
 * an image extension are taken, and the store judges the bytes after that.
 */
export async function imageFilesIn(paths: readonly string[]): Promise<Array<{ filePath: string; folders: string[] }>> {
  const found: Array<{ filePath: string; folders: string[] }> = []
  const scan = async (directory: string, folders: string[]): Promise<void> => {
    let entries
    try {
      entries = await fs.readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) await scan(entryPath, [...folders, entry.name])
      else if (entry.isFile() && hasImageExtension(entry.name)) found.push({ filePath: entryPath, folders })
    }
  }
  for (const entry of paths) {
    let stats
    try {
      stats = await fs.stat(entry)
    } catch {
      continue
    }
    if (stats.isDirectory()) await scan(entry, [path.basename(entry)])
    else if (stats.isFile() && hasImageExtension(entry)) found.push({ filePath: entry, folders: [] })
  }
  return found
}
