import { version } from '../../package.json'

/**
 * What Options > Advanced > About shows: the version, where the app is
 * published, where to report a problem, how to write, and what the app is
 * built from that asks to be credited.
 *
 * Desktop only for now. The credits differ per app (the Android app bundles
 * none of the fonts or dictionaries), so this moves into a package only when
 * the Android app grows its own About and the shared part is known.
 *
 * Every link is opened by the system's browser or mail client through
 * `thockdownExport.openExternalUrl` (`electron/networkIsolation.ts`); the
 * window itself never loads any of them.
 */

export const APP_VERSION: string = version

const REPOSITORY_URL = 'https://github.com/MorbusM59/thockdown-notes'

export interface AboutLink {
  /** The words on the button. */
  label: string
  /** What pressing it does, for the tooltip. */
  intention: string
  url: string
}

export const ABOUT_LINKS: readonly AboutLink[] = [
  { label: 'Releases', intention: 'Open the release page', url: `${REPOSITORY_URL}/releases` },
  { label: 'Issues', intention: 'Report a problem', url: `${REPOSITORY_URL}/issues` },
  { label: 'Email', intention: 'Write to thockdown@gmail.com', url: 'mailto:thockdown@gmail.com' },
]

export interface Credit {
  /** What is credited, and its licence, as the button shows it. */
  label: string
  /** What the app uses it for, for the tooltip. */
  usedFor: string
  /** Its source or licence page. */
  url: string
}

/**
 * Third-party work the app redistributes and whose licence asks for credit.
 * A new bundled font goes into `src/fonts/LICENSES.md` (the OFL's notice); a
 * new bundled dictionary, icon set or quoted text goes here.
 */
export const CREDITS: readonly Credit[] = [
  { label: 'Font Awesome Free (CC BY 4.0)', usedFor: 'Icons', url: 'https://fontawesome.com/license/free' },
  { label: 'Bundled fonts (SIL OFL 1.1)', usedFor: 'Editor, reader and interface fonts; each font\'s notice is in its file', url: `${REPOSITORY_URL}/blob/main/apps/notes/src/fonts/LICENSES.md` },
  { label: 'Hunspell (via hunspell-asm, MIT)', usedFor: 'Spell checking', url: 'https://github.com/kwonoj/hunspell-asm' },
  { label: 'English dictionary (MIT and BSD)', usedFor: 'Spell checking', url: 'https://github.com/wooorm/dictionaries/tree/main/dictionaries/en' },
  { label: 'Spanish dictionary (GPL, LGPL or MPL)', usedFor: 'Spell checking (GPL-3.0, LGPL-3.0 or MPL-1.1)', url: 'https://github.com/wooorm/dictionaries/tree/main/dictionaries/es' },
  { label: 'French dictionary (MPL-2.0)', usedFor: 'Spell checking', url: 'https://github.com/wooorm/dictionaries/tree/main/dictionaries/fr' },
  { label: 'German dictionary (GPL)', usedFor: 'Spell checking (igerman98, GPL-2.0 or GPL-3.0)', url: 'https://github.com/wooorm/dictionaries/tree/main/dictionaries/de' },
  { label: 'Universal Declaration of Human Rights', usedFor: 'The text passing by on a long jump in Reader mode (United Nations, public domain)', url: 'https://www.un.org/en/about-us/universal-declaration-of-human-rights' },
  { label: 'Electron and Chromium', usedFor: 'The app\'s runtime; their licences ship with the app as LICENSES.chromium.html', url: 'https://www.electronjs.org' },
  { label: 'CodeMirror, remark, React (MIT)', usedFor: 'The editor, Markdown parsing and the interface', url: `${REPOSITORY_URL}/blob/main/package.json` },
]
