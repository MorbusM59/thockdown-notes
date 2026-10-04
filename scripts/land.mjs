// How a change reaches main from a cloud session (CLAUDE.md, "Landing on
// main"): `npm run land` from the working branch.
//
//   1. The branch must be committed, pushed and a clean descendant of
//      origin/main (a fast-forward), as the git workflow already requires.
//   2. `npm run verify` must pass.
//   3. LOW IMPACT (scripts/impact.mjs): main is fast-forwarded to the branch
//      and pushed.
//      HIGH IMPACT: nothing is pushed to main. The branch goes through a pull
//      request instead, whose CI runs the full cross-platform check (the
//      Android build included) and which is merged once that is green.
//
// The fast-forward happens HERE, after the checks, rather than being a step
// a session remembers to take afterwards, so the rule is a command and not a
// paragraph.
import { spawnSync } from 'node:child_process'
import { changedPaths, highImpactPaths } from './impact.mjs'

function git(...args) {
  const res = spawnSync('git', args, { encoding: 'utf8' })
  if (res.status !== 0) fail(`git ${args.join(' ')} failed`, res.stderr.trim())
  return res.stdout.trim()
}

function fail(message, detail) {
  console.error(`\nland: ${message}`)
  if (detail) console.error(detail)
  process.exit(1)
}

const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
if (branch === 'main') fail('run this from a working branch, not main')
if (git('status', '--porcelain')) fail('the working tree has uncommitted changes')

git('fetch', '--quiet', 'origin', 'main', branch)
const head = git('rev-parse', 'HEAD')
if (git('rev-parse', `origin/${branch}`) !== head) fail(`push ${branch} first (origin/${branch} is not HEAD)`)
const ff = spawnSync('git', ['merge-base', '--is-ancestor', 'origin/main', 'HEAD'])
if (ff.status !== 0) fail('not a fast-forward of origin/main: merge origin/main into the branch, or open a pull request')
if (git('rev-parse', 'origin/main') === head) fail('nothing to land: main is already at HEAD')

const verify = spawnSync('npm', ['run', 'verify'], { stdio: 'inherit', shell: process.platform === 'win32' })
if (verify.status !== 0) fail('verify failed; nothing was landed')

const hits = highImpactPaths(changedPaths('origin/main', 'HEAD'))
if (hits.length) {
  console.log('\nland: verify is green, but this change is HIGH IMPACT (scripts/impact.mjs):')
  for (const p of hits) console.log(`  ${p}`)
  console.log(`\nNothing was pushed to main. Open a pull request from ${branch} into main;`)
  console.log('merge it once its CI (verify, then the Android build) is green.')
  process.exit(3)
}

git('push', '--quiet', 'origin', 'HEAD:main')
console.log(`\nland: main fast-forwarded to ${head.slice(0, 7)}`)
