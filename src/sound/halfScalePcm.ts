/**
 * How finished soundscape audio crosses from JavaScript to Android's native
 * output (SoundscapeAudioOutput.java): 16-bit little-endian interleaved
 * stereo at HALF scale, base64. Half scale because the mix may exceed full
 * scale before the listener's volume brings it down, and the volume is
 * applied natively, after the crossing; the native side doubles it back.
 *
 * Written without btoa, which the bare engine it also runs in
 * (soundscapeSandbox.ts) does not have.
 */
export const HALF_SCALE_HEADROOM = 2;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function encodeHalfScaleStereo(left: Float32Array, right: Float32Array): string {
  const bytes = new Uint8Array(left.length * 4);
  const scale = 32767 / HALF_SCALE_HEADROOM;
  for (let index = 0; index < left.length; index += 1) {
    const l = Math.max(-32768, Math.min(32767, Math.round(left[index] * scale)));
    const r = Math.max(-32768, Math.min(32767, Math.round(right[index] * scale)));
    bytes[index * 4] = l & 0xff;
    bytes[(index * 4) + 1] = (l >> 8) & 0xff;
    bytes[(index * 4) + 2] = r & 0xff;
    bytes[(index * 4) + 3] = (r >> 8) & 0xff;
  }
  return toBase64(bytes);
}

export function toBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  let line = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const c = index + 2 < bytes.length ? bytes[index + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    line += ALPHABET[(triple >> 18) & 63] + ALPHABET[(triple >> 12) & 63]
      + (index + 1 < bytes.length ? ALPHABET[(triple >> 6) & 63] : '=')
      + (index + 2 < bytes.length ? ALPHABET[triple & 63] : '=');
    if (line.length >= 4096) {
      parts.push(line);
      line = '';
    }
  }
  parts.push(line);
  return parts.join('');
}
