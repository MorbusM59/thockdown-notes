/** The score of the music, written off the analysis worker's thread (`musicScore.ts`). */

import { SignalScore, type ScoreRequest } from './musicScore'

const score = new SignalScore((update) => self.postMessage(update))

self.onmessage = (event: MessageEvent<ScoreRequest>) => {
  const request = event.data
  switch (request.type) {
    case 'reset': return score.reset(request.run, request.sampleRate, request.newTrack)
    case 'feed': return score.feed(request.run, request.samples, request.startTime)
    case 'beats': return score.beats(request.run, request.times)
    case 'heard': return score.heard(request.run, request.time)
  }
}
