/**
 * How much of an mp3's decoded start is ENCODER PADDING rather than music.
 * An mp3 encoder puts silence in front of the first sample (LAME: 576 samples)
 * and the decoder adds its own delay (529 samples); an encoder that writes a
 * LAME tag (LAME itself, and FFmpeg as "Lavc"/"Lavf") records the first in it.
 * Chromium's own decoder honours the tag and drops those samples, so what an
 * `<audio>` element plays at media time t is what a decoder that ignores the
 * tag (Mediabunny's) produces at t + this delay. Without a tag nothing is
 * dropped by either, and the delay is 0.
 *
 * The tag sits in the first frame (the Xing or Info frame), after an ID3v2
 * tag if there is one: `mp3TagOffset` says where that frame starts from the
 * file's first ten bytes, and `mp3EncoderDelaySec` reads the delay from the
 * bytes there.
 */

/** The decoder's own delay, in samples, which the tag's figure does not include. */
const DECODER_DELAY = 529

/** Where the first audio frame starts: past an ID3v2 tag if `head` (the file's first ten bytes) opens one. */
export function mp3TagOffset(head: Uint8Array): number {
  if (head.length < 10 || head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return 0
  // A syncsafe size: seven bits a byte. A footer adds ten more.
  const size = ((head[6] & 0x7f) << 21) | ((head[7] & 0x7f) << 14) | ((head[8] & 0x7f) << 7) | (head[9] & 0x7f)
  const footer = head[5] & 0x10 ? 10 : 0
  return 10 + size + footer
}

const SAMPLE_RATES: Record<number, readonly number[]> = {
  3: [44100, 48000, 32000], // MPEG 1
  2: [22050, 24000, 16000], // MPEG 2
  0: [11025, 12000, 8000], // MPEG 2.5
}

/** The encoder delay in seconds, from `bytes` starting at (or a little before) the first frame. */
export function mp3EncoderDelaySec(bytes: Uint8Array): number {
  // The first frame sync: eleven set bits.
  let at = 0
  while (at + 4 <= bytes.length && !(bytes[at] === 0xff && (bytes[at + 1] & 0xe0) === 0xe0)) at++
  if (at + 4 > bytes.length) return 0
  const version = (bytes[at + 1] >> 3) & 0x03
  const rateIndex = (bytes[at + 2] >> 2) & 0x03
  const mono = ((bytes[at + 3] >> 6) & 0x03) === 3
  const rates = SAMPLE_RATES[version]
  if (!rates || rateIndex === 3) return 0
  // The Xing/Info header follows the side information, whose size depends on version and channels.
  const sideInfo = version === 3 ? (mono ? 17 : 32) : (mono ? 9 : 17)
  const xing = at + 4 + sideInfo
  const id = String.fromCharCode(...bytes.subarray(xing, xing + 4))
  if (id !== 'Xing' && id !== 'Info') return 0
  // The LAME tag: 120 bytes after "Xing" in every encoder that writes one.
  const lame = xing + 120
  if (lame + 24 > bytes.length) return 0
  const encoder = String.fromCharCode(...bytes.subarray(lame, lame + 4))
  if (encoder !== 'LAME' && encoder !== 'Lavc' && encoder !== 'Lavf') return 0
  // Byte 21 onwards: the delay in 12 bits, then the padding in 12 bits.
  const delay = (bytes[lame + 21] << 4) | (bytes[lame + 22] >> 4)
  return (delay + DECODER_DELAY) / rates[rateIndex]
}
