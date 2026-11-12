import { parentPort, workerData } from 'node:worker_threads'
import { indexMusicRequest } from './musicIndexCore'
import type { MusicIndexRequest } from './musicIndexCore'

const port = parentPort
if (!port) throw new Error('Music index worker requires a parent port')

// A failure is rethrown, so the worker exits with an 'error' event and the
// caller's promise rejects with the real reason rather than an exit code.
indexMusicRequest(workerData as MusicIndexRequest).then((songs) => {
  port.postMessage(songs)
  port.close()
}, (error: unknown) => {
  port.close()
  throw error
})
