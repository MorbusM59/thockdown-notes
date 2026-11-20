// A Vite plugin that writes THIRD_PARTY_NOTICES.txt beside every build's
// output: the name, version, licence and full licence text of every npm
// package whose code (or stylesheet, font or other asset) that build bundled.
//
// Why: nearly every dependency is MIT, BSD or ISC licensed, and all three
// require their copyright and permission notice to accompany every copy of
// the software. A bundled, minified copy carries none of them, so the notices
// are collected from the module graph of the build itself and shipped in the
// same output folder (`dist` and `dist-electron` in the desktop app's
// package, the Android app's web assets). Collected from what the build
// actually contains, rather than from a list in package.json, so a new
// import is covered without anyone remembering this exists and a removed one
// stops being listed.
//
// A package with no licence at all fails the build: shipping it would be
// shipping code nobody gave us the right to redistribute.

import fs from 'node:fs'
import path from 'node:path'

const FILE_NAME = 'THIRD_PARTY_NOTICES.txt'
const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.|-|$)/i

/** The directory of the npm package a module id belongs to, or null for the app's own code. */
function packageDirOf(id) {
  // Vite's module ids use forward slashes on every platform.
  const clean = id.replace(/^\0/, '').split('?')[0].replaceAll('\\', '/')
  const marker = '/node_modules/'
  const at = clean.lastIndexOf(marker)
  if (at === -1) return null
  const rest = clean.slice(at + marker.length).split('/')
  const depth = rest[0].startsWith('@') ? 2 : 1
  return clean.slice(0, at + marker.length) + rest.slice(0, depth).join('/')
}

function readPackage(dir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  const license = typeof manifest.license === 'string'
    ? manifest.license.replace(/^\((.*)\)$/, '$1')
    : (manifest.license?.type ?? (Array.isArray(manifest.licenses) ? manifest.licenses.map((l) => l.type ?? l).join(' OR ') : null))
  const texts = fs.readdirSync(dir)
    .filter((name) => LICENSE_FILE.test(name))
    .sort()
    .map((name) => fs.readFileSync(path.join(dir, name), 'utf8').trim())
  return { name: manifest.name, version: manifest.version, license, texts }
}

/** The notices text for a set of package directories, sorted by package name. */
export function noticesFor(packageDirs) {
  const packages = [...packageDirs].map(readPackage).sort((a, b) => a.name.localeCompare(b.name))
  const unlicensed = packages.filter((p) => !p.license && p.texts.length === 0)
  if (unlicensed.length > 0) {
    throw new Error(`third-party notices: no licence found for ${unlicensed.map((p) => p.name).join(', ')}`)
  }
  const header = 'Third-party software bundled in this build, with the notices its licences require.\n'
  return header + packages.map((p) => [
    '',
    '='.repeat(78),
    `${p.name} ${p.version}${p.license ? ` (${p.license})` : ''}`,
    '='.repeat(78),
    '',
    p.texts.length > 0 ? p.texts.join('\n\n') : `Licensed under ${p.license}; the package ships no licence file.`,
  ].join('\n')).join('\n') + '\n'
}

/**
 * The plugins for one build. `emit` goes in the build's `plugins` and writes
 * the file; `collect` goes in its `worker.plugins`, because Vite bundles each
 * worker in a build of its own whose modules the main build never sees (the
 * spell checker's Hunspell, the music decoder). Worker builds finish while the
 * main build is still transforming, so both feed one set before `emit` writes.
 */
export function createThirdPartyNotices() {
  const dirs = new Set()
  const gather = (context) => {
    for (const id of context.getModuleIds()) {
      const dir = packageDirOf(id)
      if (dir && fs.existsSync(path.join(dir, 'package.json'))) dirs.add(dir)
    }
  }
  return {
    collect: {
      name: 'thockdown-third-party-notices-collect',
      apply: 'build',
      generateBundle() { gather(this) },
    },
    emit: {
      name: 'thockdown-third-party-notices',
      apply: 'build',
      generateBundle() {
        gather(this)
        if (dirs.size === 0) return
        this.emitFile({ type: 'asset', fileName: FILE_NAME, source: noticesFor(dirs) })
      },
    },
  }
}

/** For a build with no workers. */
export function thirdPartyNotices() {
  return createThirdPartyNotices().emit
}
