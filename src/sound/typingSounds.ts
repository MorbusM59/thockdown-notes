export const TYPING_SOUND_SET_IDS = ['A', 'B', 'C'] as const
export type TypingSoundSetId = (typeof TYPING_SOUND_SET_IDS)[number]
export const DEFAULT_TYPING_SOUND_SET: TypingSoundSetId = 'A'

export const TYPING_SOUND_ASSETS: Record<TypingSoundSetId, readonly string[]> = {
  A: [
    new URL('../assets/sounds/keys/seta/akey01.wav', import.meta.url).href,
    new URL('../assets/sounds/keys/seta/akey02.wav', import.meta.url).href,
    new URL('../assets/sounds/keys/seta/akey03.wav', import.meta.url).href,
    new URL('../assets/sounds/keys/seta/akey04.wav', import.meta.url).href,
    new URL('../assets/sounds/keys/seta/akey05.wav', import.meta.url).href,
    new URL('../assets/sounds/keys/seta/akey06.wav', import.meta.url).href,
    new URL('../assets/sounds/keys/seta/akey07.wav', import.meta.url).href,
    new URL('../assets/sounds/keys/seta/akey08.wav', import.meta.url).href,
    new URL('../assets/sounds/keys/seta/akey09.wav', import.meta.url).href,
    new URL('../assets/sounds/keys/seta/akey10.wav', import.meta.url).href,
  ],
  B: [
    new URL('../assets/sounds/keys/setb/bkey01.wav', import.meta.url).href,
    new URL('../assets/sounds/keys/setb/bkey02.wav', import.meta.url).href,
    new URL('../assets/sounds/keys/setb/bkey03.wav', import.meta.url).href,
    new URL('../assets/sounds/keys/setb/bkey04.wav', import.meta.url).href,
    new URL('../assets/sounds/keys/setb/bkey05.wav', import.meta.url).href,
    new URL('../assets/sounds/keys/setb/bkey06.wav', import.meta.url).href,
    new URL('../assets/sounds/keys/setb/bkey07.wav', import.meta.url).href,
    new URL('../assets/sounds/keys/setb/bkey08.wav', import.meta.url).href,
    new URL('../assets/sounds/keys/setb/bkey09.wav', import.meta.url).href,
    new URL('../assets/sounds/keys/setb/bkey10.wav', import.meta.url).href,
  ],
  C: [
    new URL('../assets/sounds/keys/setc/ckey-01.wav', import.meta.url).href,
    new URL('../assets/sounds/keys/setc/ckey-02.wav', import.meta.url).href,
    new URL('../assets/sounds/keys/setc/ckey-03.wav', import.meta.url).href,
    new URL('../assets/sounds/keys/setc/ckey-04.wav', import.meta.url).href,
    new URL('../assets/sounds/keys/setc/ckey-05.wav', import.meta.url).href,
    new URL('../assets/sounds/keys/setc/ckey-06.wav', import.meta.url).href,
    new URL('../assets/sounds/keys/setc/ckey-07.wav', import.meta.url).href,
    new URL('../assets/sounds/keys/setc/ckey-08.wav', import.meta.url).href,
    new URL('../assets/sounds/keys/setc/ckey-09.wav', import.meta.url).href,
    new URL('../assets/sounds/keys/setc/ckey-10.wav', import.meta.url).href,
  ],
} as const;

export const BASS_TYPING_SOUND_ASSET = new URL('../assets/sounds/bass.wav', import.meta.url).href
export const TREBLE_TYPING_SOUND_ASSET = new URL('../assets/sounds/treble.wav', import.meta.url).href
