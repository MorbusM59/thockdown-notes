import { Worker } from 'node:worker_threads'
import type { IndexedMusicFile } from '../src/shared/audioPlayer'
import type { MusicIndexRequest } from './musicIndexCore'

export function indexMusicFiles(filePaths: string[]): Promise<IndexedMusicFile[]> {
  return runMusicIndex({ kind: 'files', filePaths })
}

export function indexMusicFolder(folderPath: string): Promise<IndexedMusicFile[]> {
  return runMusicIndex({ kind: 'folder', folderPath })
}

function runMusicIndex(request: MusicIndexRequest): Promise<IndexedMusicFile[]> {
  const worker = new Worker(new URL('./musicIndexWorker.js', import.meta.url), {
    workerData: request,
  })

  return new Promise((resolve, reject) => {
    let settled = false
    const settle = (complete: () => void) => {
      if (settled) return
      settled = true
      complete()
    }

    worker.once('message', (songs: IndexedMusicFile[]) => settle(() => resolve(songs)))
    worker.once('error', (error) => settle(() => reject(error)))
    worker.once('exit', (code) => {
      if (!settled) {
        settle(() => reject(new Error(`Music index worker exited before returning results (code ${code})`)))
      }
    })
  })
}
