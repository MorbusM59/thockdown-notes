// Which changes need the full cross-platform check before they reach main
// (CLAUDE.md, "Git workflow"). Decided by WHAT A CHANGE TOUCHES, never by
// judgement, so the line cannot drift from one session to the next.
//
// A change is HIGH IMPACT when it touches something `npm run verify` cannot
// fully check -- the native Android build, which needs the Android SDK and
// runs only in CI -- or something that changes what every build is made of:
//   - the Android project, its Capacitor config, and the web code that talks
//     to the native side across the plugin boundary;
//   - the Android-only playback (the render-ahead renderer and what the
//     JavaScriptSandbox runs), which no desktop build or test executes as
//     shipped;
//   - dependencies (a new or upgraded package changes every app's bundle);
//   - the gate itself (CI workflows, verify, this list, the land and release
//     scripts) and the build, packaging and type configuration
//     (electron-builder included, which verify never runs), so a direct push
//     cannot loosen the check that would have caught it.
// Everything else is LOW IMPACT: `npm run verify` checks it for every app,
// and it may be fast-forwarded onto main directly.
//
// Used by scripts/land.mjs (refuses the fast-forward) and by CI (flags a
// high-impact change that reached main without a pull request).
import { spawnSync } from 'node:child_process'

export const HIGH_IMPACT = [
  /^apps\/soundscapes\/android\//,
  /(^|\/)capacitor\.config\.ts$/,
  /^apps\/soundscapes\/src\/(backgroundAudioHost|nativeSoundscapePlayback)\.ts$/,
  /^packages\/soundscape\/(soundscapeRenderAhead|soundscapeSandbox|soundscapeGeneratorHost|halfScalePcm)\.ts$/,
  /(^|\/)package(-lock)?\.json$/,
  /^\.github\/workflows\//,
  /^scripts\/(verify|impact|land|release)\.mjs$/,
  /^electron-builder[^/]*\.json5$/,
  /(^|\/)vite(\.[a-z]+)?\.config\.ts$/,
  /(^|\/)tsconfig(\.[a-z]+)?\.json$/,
]

/** The paths in `paths` that make a change high impact. */
export function highImpactPaths(paths) {
  return paths.filter((p) => HIGH_IMPACT.some((rule) => rule.test(p)))
}

/**
 * Every path changed between two commits. Renames are reported as a deletion
 * and an addition, so moving a high-impact file somewhere unlisted still names
 * the path it left.
 */
export function changedPaths(from, to) {
  const res = spawnSync('git', ['diff', '--name-only', '--no-renames', from, to], { encoding: 'utf8' })
  if (res.status !== 0) throw new Error(`git diff ${from} ${to} failed: ${res.stderr.trim()}`)
  return res.stdout.split('\n').filter(Boolean)
}

// CLI: `node scripts/impact.mjs <from> <to>` prints the high-impact paths in
// that range and exits 1 if there are any.
if (import.meta.url === `file://${process.argv[1]}`) {
  const [from, to] = process.argv.slice(2)
  const hits = highImpactPaths(changedPaths(from, to))
  for (const p of hits) console.log(p)
  process.exit(hits.length ? 1 : 0)
}
