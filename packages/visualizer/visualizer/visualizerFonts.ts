/**
 * The monospace fonts the visualizer scene can be drawn in (Options >
 * Visualizer's font picker on the desktop, the Visualizer tab's on the phone),
 * which the desktop also offers as editor fonts. Their faces are declared in
 * visualizer.css, and their files' URLs in visualizerFontFiles.ts (apart, so
 * that what reads only the list, such as the main process's state
 * sanitizer, never takes the files with it).
 */
export type MonoFontKey =
  | 'syne'
  | 'redhat'
  | 'vt323'
  | 'victormono'
  | 'bytesized'
  | 'iosevkacharon'
  | 'kodemono'
  | 'xanhmono'
  | 'lekton'
  | 'novamono'
  | 'sharetech'
  | 'courierprime'

export type MonoFont = { key: MonoFontKey; label: string; face: string; family: string }

const FALLBACK = "'Menlo', 'Monaco', monospace"

function font(key: MonoFontKey, label: string, face: string): MonoFont {
  return { key, label, face, family: `'${face}', ${FALLBACK}` }
}

/** In picker order. */
export const MONO_FONTS: ReadonlyArray<MonoFont> = [
  font('syne', 'Syne', 'Syne Mono'),
  font('redhat', 'Red Hat', 'Red Hat Mono'),
  font('vt323', 'VT323', 'VT323'),
  font('victormono', 'Victor Mono', 'Victor Mono'),
  font('bytesized', 'Bytesized', 'Bytesized'),
  font('iosevkacharon', 'Iosevka Charon', 'Iosevka Charon Mono'),
  font('kodemono', 'Kode Mono', 'Kode Mono'),
  font('xanhmono', 'Xanh Mono', 'Xanh Mono'),
  font('lekton', 'Lekton', 'Lekton'),
  font('novamono', 'Nova Mono', 'Nova Mono'),
  font('sharetech', 'Share Tech', 'Share Tech Mono'),
  font('courierprime', 'Courier Prime', 'Courier Prime'),
]

export function isMonoFontKey(value: unknown): value is MonoFontKey {
  return MONO_FONTS.some((option) => option.key === value)
}

/** The CSS font-family of `key`, falling back to `fallback`'s (an unknown key from an older save). */
export function monoFontFamily(key: MonoFontKey, fallback: MonoFontKey = 'kodemono'): string {
  return (MONO_FONTS.find((option) => option.key === key) ?? MONO_FONTS.find((option) => option.key === fallback)!).family
}
