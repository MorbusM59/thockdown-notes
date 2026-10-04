export const AUDIO_BOUNCE_CHANNELS = {
  getCached: 'audio-bounce:cache:get',
  saveCached: 'audio-bounce:cache:save',
} as const

export type AudioBounceCacheRequest = {
  keyId: string
  settingsSignature: string
}

export type AudioBounceCacheHit = {
  // Each channel's Float32 samples, concatenated back-to-back.
  data: Uint8Array
  sampleRate: number
  numberOfChannels: number
  length: number
}

export interface AudioBounceCacheApi {
  getCachedBounce(request: AudioBounceCacheRequest): Promise<AudioBounceCacheHit | null>
  saveCachedBounce(request: AudioBounceCacheRequest, payload: AudioBounceCacheHit): Promise<void>
}
