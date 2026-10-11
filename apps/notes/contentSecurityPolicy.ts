// The renderer's Content-Security-Policy, injected into the built index.html
// as a <meta> tag by vite.config.ts (the packaged app loads from file://,
// where there are no response headers to carry it).
//
// What it states: the page runs only the app's own bundled scripts (no
// inline script, no eval), and loads every other resource from the app
// itself or from local schemes. It is the backstop behind two other layers
// -- markdown is rendered without raw HTML, and the main process cancels any
// network request (electron/networkIsolation.ts) -- so that a future change
// which did let markup through still could not execute it.
//
// Each allowance below is there for something the app actually does:
// - style-src 'unsafe-inline'   React `style` props and the theme's runtime
//   CSS variables are inline styles. Styles cannot execute code.
// - img-src data: blob: file:   textures are rendered to blob URLs, the
//   export embeds data URIs, and a note may show an image from the local disk.
// - font-src data:     the export path inlines fonts as data URIs.
// - media-src / connect-src thockdown-music:   local music files are served
//   through that protocol (electron/main.ts), and sounds are fetched as
//   local assets.
//
// Not applied to the Vite dev server: its React refresh preamble is an inline
// script. The network block applies there regardless.
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "worker-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: file:",
  "font-src 'self' data:",
  "media-src 'self' data: blob: thockdown-music:",
  "connect-src 'self' data: blob: thockdown-music:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ')
