import type { MonoFontKey } from './visualizerFonts'

/** Each of `MONO_FONTS`' files, for a reader that needs the file itself, such as the desktop's HTML export. Written out in full so the bundler finds them. */
export const MONO_FONT_URLS: Record<MonoFontKey, string> = {
  syne: new URL('./fonts/SyneMono-Regular.woff2', import.meta.url).href,
  redhat: new URL('./fonts/RedHatMono-Regular.woff2', import.meta.url).href,
  vt323: new URL('./fonts/VT323-Regular.woff2', import.meta.url).href,
  victormono: new URL('./fonts/VictorMono-Regular.woff2', import.meta.url).href,
  bytesized: new URL('./fonts/Bytesized-Regular.woff2', import.meta.url).href,
  iosevkacharon: new URL('./fonts/IosevkaCharonMono-Regular.woff2', import.meta.url).href,
  kodemono: new URL('./fonts/KodeMono-Regular.woff2', import.meta.url).href,
  xanhmono: new URL('./fonts/XanhMono-Regular.woff2', import.meta.url).href,
  lekton: new URL('./fonts/Lekton-Regular.woff2', import.meta.url).href,
  novamono: new URL('./fonts/NovaMono-Regular.woff2', import.meta.url).href,
  sharetech: new URL('./fonts/ShareTechMono-Regular.woff2', import.meta.url).href,
  courierprime: new URL('./fonts/CourierPrime-Regular.woff2', import.meta.url).href,
}
