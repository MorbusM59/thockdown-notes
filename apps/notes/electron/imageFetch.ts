// verify: reads-temp (scripts/verify.mjs, "what a module reads from disk")
import { session, type Session } from 'electron'
import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { MAX_STORED_IMAGE_BYTES } from '../src/shared/images'

// GETTING AN IMAGE'S BYTES FROM WHERE A NOTE POINTS, for storing it
// (src/shared/images.ts). Runs only when the reader holds the image button,
// which is the consent, per image, at that moment -- so it works with remote
// images turned off.
//
// The page's own network rule is untouched: downloads go through a separate,
// in-memory session (no cookies, cache or referrer shared with the window),
// and this code enforces its own limits rather than leaning on a request
// filter, which would not see a main-process request's redirects: only
// http(s) at the start and at the end of any redirects, the size cap counted
// while the body streams, and a timeout for the whole of it.

const FETCH_TIMEOUT_MS = 30_000

export type FetchedImage =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: 'too-large' | 'unreachable' | 'unsupported' }

let fetchSession: Session | null = null
function imageFetchSession(): Session {
  // A partition name without `persist:` lives in memory only.
  fetchSession ??= session.fromPartition('image-fetch', { cache: false })
  return fetchSession
}

/** Reads a note's image source: an http(s) URL, a file: URL or an absolute path. */
export async function fetchImageSource(source: string): Promise<FetchedImage> {
  const url = URL.canParse(source) ? new URL(source) : null
  if (url && (url.protocol === 'http:' || url.protocol === 'https:')) return download(url)
  const filePath = url?.protocol === 'file:' ? safeFileURLToPath(url) : (path.isAbsolute(source) ? source : null)
  if (!filePath) return { ok: false, reason: 'unsupported' }
  return readFile(filePath)
}

function safeFileURLToPath(url: URL): string | null {
  try {
    return fileURLToPath(url)
  } catch {
    return null
  }
}

async function readFile(filePath: string): Promise<FetchedImage> {
  try {
    const stat = await fs.stat(filePath)
    if (!stat.isFile()) return { ok: false, reason: 'unreachable' }
    if (stat.size > MAX_STORED_IMAGE_BYTES) return { ok: false, reason: 'too-large' }
    return { ok: true, bytes: new Uint8Array(await fs.readFile(filePath)) }
  } catch {
    return { ok: false, reason: 'unreachable' }
  }
}

async function download(url: URL): Promise<FetchedImage> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), FETCH_TIMEOUT_MS)
  try {
    {
      // Redirects are followed by Chromium's network stack, which refuses to
      // leave http(s) for any other scheme on its own (a redirect to file:
      // fails the request). `redirect: 'manual'` cannot be used to check each
      // hop here: it answers with an opaque response that carries no
      // Location. Where the request ENDED is checked below as well.
      const response = await imageFetchSession().fetch(url.href, {
        redirect: 'follow',
        signal: abort.signal,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      })
      if (!/^https?:/.test(response.url || url.href)) return { ok: false, reason: 'unsupported' }
      if (!response.ok || !response.body) return { ok: false, reason: 'unreachable' }
      const declared = Number(response.headers.get('content-length'))
      if (Number.isFinite(declared) && declared > MAX_STORED_IMAGE_BYTES) {
        abort.abort()
        return { ok: false, reason: 'too-large' }
      }
      const parts: Uint8Array[] = []
      let total = 0
      const reader = response.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > MAX_STORED_IMAGE_BYTES) {
          abort.abort()
          return { ok: false, reason: 'too-large' }
        }
        parts.push(value)
      }
      const bytes = new Uint8Array(total)
      let offset = 0
      for (const part of parts) {
        bytes.set(part, offset)
        offset += part.byteLength
      }
      return { ok: true, bytes }
    }
  } catch {
    return { ok: false, reason: 'unreachable' }
  } finally {
    clearTimeout(timer)
  }
}
