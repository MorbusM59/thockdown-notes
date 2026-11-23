import type { AboutLink, Credit } from '@thockdown/interaction/AboutPanel'
import { version } from '../package.json'

/**
 * What the phone's About (the Settings tab) shows, drawn by the shared
 * `@thockdown/interaction/AboutPanel`. The desktop's list is
 * `apps/notes/src/about/about.ts`; this app bundles none of its fonts or
 * dictionaries, so only what ships here is credited.
 *
 * A link is opened by handing the URL to the WebView as a navigation: an
 * address outside the app's own is passed by Capacitor to the system (browser
 * or mail client), so the app itself needs no network permission to offer it.
 */

export const APP_VERSION: string = version

const REPOSITORY_URL = 'https://github.com/MorbusM59/thockdown-notes'

export const ABOUT_LINKS: readonly AboutLink[] = [
  { label: 'Privacy', intention: 'Read the privacy policy', url: `${REPOSITORY_URL}/blob/main/apps/soundscapes/PRIVACY.md` },
  { label: 'Issues', intention: 'Report a problem', url: `${REPOSITORY_URL}/issues` },
  { label: 'Email', intention: 'Write to thockdown@gmail.com', url: 'mailto:thockdown@gmail.com' },
]

export const CREDITS: readonly Credit[] = [
  { label: 'Font Awesome Free (CC BY 4.0)', usedFor: 'Icons', url: 'https://fontawesome.com/license/free' },
  { label: 'Capacitor, React and more', usedFor: 'Every bundled library\'s license notice ships inside the app as THIRD_PARTY_NOTICES.txt', url: `${REPOSITORY_URL}/blob/main/package.json` },
]

export function openAboutLink(url: string): void {
  window.location.href = url
}
