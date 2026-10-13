import { IMAGE_SCHEME } from './images'

// AN IMAGE ON THIS COMPUTER'S DISK, written in a note by its path: an
// absolute Windows path (`C:\...`, `\\server\share\...`), an absolute POSIX
// path (`/home/...`) or a `file:` URL. Reading it is not a network request,
// so the remote-images setting does not apply. The page cannot load a path
// itself, so the main process serves the file on the image scheme's `file`
// host (electron/main.ts), image types only.

/** The absolute file path `src` names, or null when it is not a local path. */
export function localImagePath(src: string | undefined): string | null {
  if (!src) return null
  if (/^[A-Za-z]:[\\/]/.test(src) || src.startsWith('\\\\') || src.startsWith('/')) return src
  if (/^file:/i.test(src)) {
    try {
      const url = new URL(src)
      const pathname = decodeURIComponent(url.pathname)
      // file:///C:/x arrives as /C:/x; a host is a UNC share.
      if (url.host) return `\\\\${url.host}${pathname.replace(/\//g, '\\')}`
      return /^\/[A-Za-z]:/.test(pathname) ? pathname.slice(1) : pathname
    } catch {
      return null
    }
  }
  return null
}

/** The address the page loads a local image from, or null when `src` is not a local path. */
export function localImageSrc(src: string | undefined): string | null {
  const path = localImagePath(src)
  return path === null ? null : `${IMAGE_SCHEME}://file/${encodeURIComponent(path)}`
}
