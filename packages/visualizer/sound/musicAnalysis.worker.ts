/** The beat pulse's analysis off the page's thread (`musicAnalysis.ts`): each request handled in order, each ask answered. */

import { MusicAnalysis, type AnalysisFailure, type AnalysisRequest } from './musicAnalysis'

const analysis = new MusicAnalysis(undefined, (run, message) => {
  const failure: AnalysisFailure = { type: 'failure', run, message }
  self.postMessage(failure)
})

self.onmessage = (event: MessageEvent<AnalysisRequest>) => {
  const answer = analysis.handle(event.data)
  if (answer) self.postMessage(answer)
}
