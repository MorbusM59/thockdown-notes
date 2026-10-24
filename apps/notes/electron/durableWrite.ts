import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Replaces `filePath`'s contents with `text` so that, whenever the process
 * dies or the power goes, the file holds either its old contents or its new
 * ones -- never a truncated or empty file.
 *
 * The text goes to a hidden sibling first and is flushed to disk BEFORE the
 * rename that puts it in place: a rename can reach the disk ahead of the
 * data it points at, and a power cut between the two leaves an empty file
 * where the last good one was. The original's permissions are carried over,
 * since the rename puts a new file in its place.
 *
 * On Windows a rename over a file another process holds open (an antivirus
 * scan, a search indexer) fails with EPERM/EACCES/EBUSY; there the file is
 * written in place instead, and flushed.
 */
export async function writeFileDurably(filePath: string, text: string): Promise<void> {
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.thockdown-tmp`);
  const mode = await fs.stat(filePath).then((stats) => stats.mode, () => undefined);
  await writeAndFlush(tempPath, text, mode);
  try {
    await fs.rename(tempPath, filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    await fs.rm(tempPath, { force: true });
    if (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY') throw error;
    await writeAndFlush(filePath, text, undefined);
  }
}

async function writeAndFlush(filePath: string, text: string, mode: number | undefined): Promise<void> {
  const handle = await fs.open(filePath, 'w', mode);
  try {
    await handle.writeFile(text, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}
