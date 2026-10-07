import type { InvokeChannels } from './ipcContract';
export const AUDIO_BOUNCE_CHANNELS = {
  getCachedBounce: 'audio-bounce:cache:get',
  saveCachedBounce: 'audio-bounce:cache:save',
} as const satisfies InvokeChannels<AudioBounceCacheApi>

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
