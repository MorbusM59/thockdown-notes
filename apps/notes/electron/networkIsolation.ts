import { app, session, shell } from 'electron'
import { fileURLToPath } from 'node:url'

// The desktop app makes no network requests of its own: every note, sound,
// texture and font it shows is on the local disk. This module enforces that
// rather than relying on nothing in the renderer ever asking for a URL.
//
// Three doors are closed, for every web contents the app ever creates:
// - REQUESTS: any http(s)/ws(s)/ftp request from a page is cancelled, except
//   to the Vite dev server in an unpackaged run (that is where the renderer
//   itself is served from), and except IMAGES while the reader has turned
//   remote images on (`setRemoteImagesAllowed`, from the persisted
//   `allowRemoteImages`). Local schemes (file:, data:, blob:, devtools:, and
//   the app's own thockdown-music:) are untouched.
// - NAVIGATION: a page may not navigate away from the document it loaded
//   (a link dropped onto the window would otherwise replace the app with a
//   remote site that still has the preload bridge attached).
// - NEW WINDOWS: window.open and target=_blank never create an Electron
//   window; a web URL is handed to the system browser instead, through the
//   same scheme check the renderer's openExternalUrl call uses.

const EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:'])
const NETWORK_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:', 'ftp:'])

/**
 * Follows a link out of the app. Web, mail and phone links go to the system's
 * default handler. A `file:` link only REVEALS the file in Explorer/Finder:
 * the system's "open" (`shell.openPath`) runs executables, so a note linking
 * to a .exe, .bat or .ps1 would launch it in one click. Anything else is
 * ignored.
 */
export async function openExternalIfAllowed(url: unknown): Promise<void> {
  if (typeof url !== 'string') return
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return
  }
  if (EXTERNAL_SCHEMES.has(parsed.protocol)) {
    await shell.openExternal(url)
  } else if (parsed.protocol === 'file:') {
    let filePath: string
    try {
      filePath = fileURLToPath(parsed)
    } catch {
      // A file URL naming a remote host, or one this platform cannot map.
      return
    }
    shell.showItemInFolder(filePath)
  }
}

let remoteImagesAllowed = false

/**
 * Follows the persisted `allowRemoteImages` setting. Called with the stored
 * value before the window loads and again on every save of the app state, so
 * the request filter reads the same setting the preview draws from -- the
 * renderer cannot widen it by any other route.
 */
export function setRemoteImagesAllowed(allowed: boolean): void {
  remoteImagesAllowed = allowed
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

export function installNetworkIsolation(devServerUrl: string | undefined): void {
  const devOrigin = devServerUrl ? originOf(devServerUrl) : null

  const isAllowedRequest = (url: string, resourceType: string): boolean => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return false
    }
    if (!NETWORK_SCHEMES.has(parsed.protocol)) return true
    if (remoteImagesAllowed && resourceType === 'image' && (parsed.protocol === 'http:' || parsed.protocol === 'https:')) return true
    if (devOrigin === null) return false
    // The dev server's hot-reload socket is ws: on the same host and port.
    const asHttp = parsed.protocol === 'ws:' ? `http://${parsed.host}` : parsed.protocol === 'wss:' ? `https://${parsed.host}` : parsed.origin
    return asHttp === devOrigin
  }

  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isAllowedRequest(details.url, details.resourceType) })
  })

  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      void openExternalIfAllowed(url)
      return { action: 'deny' }
    })
    contents.on('will-navigate', (event, url) => {
      const current = contents.getURL()
      // The first load of a fresh web contents has no current URL yet.
      if (current === '' || url === current) return
      // In-document hash changes do not fire will-navigate; anything else
      // leaving the loaded document is refused, and a web URL goes to the
      // system browser instead.
      event.preventDefault()
      void openExternalIfAllowed(url)
    })
    contents.on('will-attach-webview', (event) => {
      event.preventDefault()
    })
  })
}
