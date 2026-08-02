import { normalizeInternalText } from '../editor/TextPolicy'

/**
 * Computes a SHA-256 hex digest of the normalized text. This is the same
 * normalization used by the persistence layer's contentChecksum, so a
 * digest computed in the renderer can be compared directly to one computed
 * in the main process.
 */
export async function hashNormalizedText(text: string): Promise<string> {
  const normalized = normalizeInternalText(text)
  const encoder = new TextEncoder()
  const data = encoder.encode(normalized)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
