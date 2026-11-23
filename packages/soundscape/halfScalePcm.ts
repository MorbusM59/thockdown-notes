/**
 * How finished soundscape audio crosses from JavaScript to Android's native
 * output (AudioOutput.java, OutputLane.java): 16-bit little-endian interleaved
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

const DECODE = new Int16Array(128).fill(-1);
for (let index = 0; index < ALPHABET.length; index += 1) DECODE[ALPHABET.charCodeAt(index)] = index;

/**
 * The other direction: decoded audio from Android's decoder into the bare
 * engine, as base64 of 16-bit little-endian interleaved stereo at FULL scale
 * (a file's own samples, with no mix to leave headroom for). Written without
 * atob for the same reason.
 */
export function decodeFullScaleStereo(base64: string): [Float32Array, Float32Array] {
  let length = base64.length;
  while (length > 0 && base64[length - 1] === '=') length -= 1;
  const bytes = new Uint8Array(Math.floor((length * 3) / 4));
  let byte = 0;
  for (let index = 0; index < length; index += 4) {
    const a = DECODE[base64.charCodeAt(index)];
    const b = DECODE[base64.charCodeAt(index + 1)];
    const c = index + 2 < length ? DECODE[base64.charCodeAt(index + 2)] : 0;
    const d = index + 3 < length ? DECODE[base64.charCodeAt(index + 3)] : 0;
    const triple = (a << 18) | (b << 12) | (c << 6) | d;
    if (byte < bytes.length) bytes[byte++] = (triple >> 16) & 0xff;
    if (byte < bytes.length) bytes[byte++] = (triple >> 8) & 0xff;
    if (byte < bytes.length) bytes[byte++] = triple & 0xff;
  }
  const frames = Math.floor(bytes.length / 4);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < frames; index += 1) {
    left[index] = view.getInt16(index * 4, true) / 32768;
    right[index] = view.getInt16((index * 4) + 2, true) / 32768;
  }
  return [left, right];
}
