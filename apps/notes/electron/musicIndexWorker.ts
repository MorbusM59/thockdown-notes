import { parentPort, workerData } from 'node:worker_threads'
import { indexMusicRequest } from './musicIndexCore'
import type { MusicIndexRequest } from './musicIndexCore'

const port = parentPort
if (!port) throw new Error('Music index worker requires a parent port')

void indexMusicRequest(workerData as MusicIndexRequest).then((songs) => {
  port.postMessage(songs)
  port.close()
})
