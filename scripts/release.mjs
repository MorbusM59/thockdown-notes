#!/usr/bin/env node
// Thockdown Notes release driver.  See docs/release-protocol.md.
//
//   npm run release              -- patch bump (0.5.7 -> 0.5.8)
//   npm run release -- minor     -- 0.5.7 -> 0.6.0
//   npm run release -- major     -- 0.5.7 -> 1.0.0
//   npm run release -- 0.7.2     -- an exact version
//
//   --dry-run     print every step, change nothing, push nothing
//   --yes         don't pause for the release-notes edit
//   --force-new   bump even when the current version's release is unfinished
//
// The script is resumable: every phase checks whether its work already exists
// before doing it, so re-running after a failure picks up where it stopped
// rather than starting over or double-tagging.
//
// Windows builds locally (this machine); macOS builds on GitHub Actions
// (.github/workflows/build-mac.yml), because only a mac can produce a DMG.
// The two halves meet at the GitHub release.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const notesDir = path.join(repoRoot, 'release-notes')
const changelogPath = path.join(repoRoot, 'apps/notes/CHANGELOG.md')

// Each app in the repository releases on its own, so a release tag names its
// app: `notes-v0.8.0` here, `soundscapes-v1.0.0` for the Android app
// (.github/workflows/release-android.yml). Releases up to 0.7.1 were tagged
// with the bare `v` prefix from before the repository held a second app; they
// are read as this app's history and never written again.
const TAG_PREFIX = 'notes-v'
const LEGACY_TAG_PREFIX = 'v'
const tagFor = (v) => `${TAG_PREFIX}${v}`
const isReleaseTag = (t) => t.startsWith(TAG_PREFIX) || /^v\d/.test(t)

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const DRY_RUN = flag('--dry-run')
const ASSUME_YES = flag('--yes')
const bumpArg = args.find((a) => !a.startsWith('--')) ?? 'patch'

// ---------------------------------------------------------------- plumbing

const bold = (s) => `\x1b[1m${s}\x1b[0m`
const dim = (s) => `\x1b[2m${s}\x1b[0m`
const green = (s) => `\x1b[32m${s}\x1b[0m`
const yellow = (s) => `\x1b[33m${s}\x1b[0m`
const red = (s) => `\x1b[31m${s}\x1b[0m`

let phaseNumber = 0
const phase = (title) => console.log(`\n${bold(`[${++phaseNumber}] ${title}`)}`)
const info = (msg) => console.log(`    ${msg}`)
const ok = (msg) => console.log(`    ${green('OK')}  ${msg}`)
const warn = (msg) => console.log(`    ${yellow('!!')}  ${msg}`)

function die(msg, hint) {
  console.error(`\n${red('FAILED')}  ${msg}`)
  if (hint) console.error(`        ${dim(hint)}`)
  process.exit(1)
}

// spawnSync with shell:true does not quote arguments for us, and this repo's
// artifact paths contain spaces ("Thockdown Notes-Windows-...").  Quote here.
const quote = (arg) => (/[\s"'&|<>^()]/.test(String(arg)) ? `"${String(arg).replace(/"/g, '\\"')}"` : String(arg))

function run(cmd, cmdArgs, { capture = false, allowFail = false, cwd = repoRoot } = {}) {
  const line = [cmd, ...cmdArgs.map(quote)].join(' ')
  const res = spawnSync(line, {
    cwd,
    shell: true,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (res.status !== 0 && !allowFail) {
    die(`command failed: ${line}`, capture ? (res.stderr || '').trim() : undefined)
  }
  return {
    status: res.status,
    stdout: (res.stdout ?? '').trim(),
    stderr: (res.stderr ?? '').trim(),
  }
}

const git = (...a) => run('git', a, { capture: true }).stdout
const gitQuiet = (...a) => run('git', a, { capture: true, allowFail: true })
const gh = (...a) => run('gh', a, { capture: true }).stdout
const ghQuiet = (...a) => run('gh', a, { capture: true, allowFail: true })

function mutate(description, fn) {
  if (DRY_RUN) {
    info(`${dim('[dry-run] would')} ${description}`)
    return undefined
  }
  return fn()
}

async function pause(question) {
  if (ASSUME_YES || DRY_RUN) return
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  await new Promise((resolve) => {
    rl.question(`\n    ${question} `, () => {
      rl.close()
      resolve()
    })
  })
}

const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')

// ------------------------------------------------------- 1. preflight

phase('Preflight')

if (DRY_RUN) warn('dry run: nothing will be committed, pushed, built, or uploaded')

if (gitQuiet('rev-parse', '--git-dir').status !== 0) die('not inside a git repository')

const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
if (branch !== 'main') die(`on branch "${branch}", not main`, 'Releases are cut from main.')

if (git('status', '--porcelain')) {
  die('working tree is dirty', 'Commit or stash everything before releasing.')
}

run('git', ['fetch', 'origin', '--tags', '--quiet'], { capture: true })
const localHead = git('rev-parse', 'HEAD')
const remoteHead = git('rev-parse', 'origin/main')
if (localHead !== remoteHead) {
  const ahead = git('rev-list', '--count', 'origin/main..HEAD')
  const behind = git('rev-list', '--count', 'HEAD..origin/main')
  die(
    `local main and origin/main disagree (${ahead} ahead, ${behind} behind)`,
    'Push or pull until they match, then re-run.',
  )
}
ok(`main is clean and in sync with origin (${localHead.slice(0, 7)})`)

if (ghQuiet('auth', 'status').status !== 0) {
  die('GitHub CLI is not authenticated', 'Run: gh auth login')
}
ok('gh is authenticated')

// ------------------------------------------------------- 2. version

phase('Version')

// The desktop app owns its version; the repository root is only the workspace.
const appDir = path.join(repoRoot, 'apps', 'notes')
const pkgPath = path.join(appDir, 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
const currentVersion = pkg.version

function nextVersion(current, bump) {
  if (/^\d+\.\d+\.\d+$/.test(bump)) return bump
  const [maj, min, pat] = current.split('.').map(Number)
  if (bump === 'major') return `${maj + 1}.0.0`
  if (bump === 'minor') return `${maj}.${min + 1}.0`
  if (bump === 'patch') return `${maj}.${min}.${pat + 1}`
  return die(`unrecognized version argument "${bump}"`, 'Use patch, minor, major, or an exact x.y.z.')
}

// The deliverable set for a finished release.  Used to tell "unfinished" from
// "done", which is the whole basis of resuming.
function releaseIsComplete(t) {
  const res = ghQuiet('release', 'view', t, '--json', 'assets')
  if (res.status !== 0 || !res.stdout) return false
  const names = JSON.parse(res.stdout).assets.map((a) => a.name)
  return names.some((n) => n.endsWith('.dmg'))
    && names.some((n) => n.endsWith('.exe'))
    && names.includes('SHA256SUMS.txt')
}

// A run that got as far as step 5 has already written its version into
// package.json.  Bumping off that would cut a *second* release rather than
// finish the first -- which is precisely how v0.5.8 stalled without its DMG
// and a re-run silently produced v0.5.9.  So: if the current version is
// tagged and its release is incomplete, resume it.
const currentTag = tagFor(currentVersion)
const currentIsTagged = gitQuiet('rev-parse', '-q', '--verify', `refs/tags/${currentTag}`).status === 0
const versionGivenExplicitly = /^\d+\.\d+\.\d+$/.test(bumpArg)

let version
if (!versionGivenExplicitly && !flag('--force-new') && currentIsTagged && !releaseIsComplete(currentTag)) {
  version = currentVersion
  warn(`${currentTag} is tagged but its release is unfinished -- resuming it rather than bumping`)
  warn('pass --force-new to cut a new version anyway')
} else {
  version = nextVersion(currentVersion, bumpArg)
}

const tag = tagFor(version)
const tagExists = gitQuiet('rev-parse', '-q', '--verify', `refs/tags/${tag}`).status === 0

if (!tagExists && version === currentVersion) {
  die(`version is already ${version} and no tag ${tag} exists`, 'Pass an explicit version to force one.')
}
info(`${currentVersion}  ->  ${bold(version)}   tag ${tag}`)
if (tagExists) warn(`tag ${tag} already exists locally -- resuming an interrupted release`)

// The previous release tag, for the change summary: the newest of this app's
// tags under either prefix, ordered by version rather than by name.
const versionOf = (t) => (t.startsWith(TAG_PREFIX) ? t.slice(TAG_PREFIX.length) : t.slice(LEGACY_TAG_PREFIX.length))
const compareVersions = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number))
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}
const previousTag = git('tag', '--list', `${TAG_PREFIX}*`, `${LEGACY_TAG_PREFIX}*`)
  .split('\n')
  .map((t) => t.trim())
  .filter((t) => t && t !== tag && isReleaseTag(t))
  .sort((a, b) => compareVersions(versionOf(b), versionOf(a)))[0]

// ------------------------------------------------------- 3. release notes

phase('Release notes')

fs.mkdirSync(notesDir, { recursive: true })
const notesPath = path.join(notesDir, `${tag}.md`)

if (fs.existsSync(notesPath)) {
  ok(`reusing existing notes: ${path.relative(repoRoot, notesPath)}`)
} else {
  const range = previousTag ? `${previousTag}..HEAD` : 'HEAD'
  const subjects = git('log', range, '--no-merges', '--pretty=format:%s')
    .split('\n')
    .filter(Boolean)
  const draft = [
    `<!-- Release notes for ${tag}. The text below becomes the GitHub release body verbatim.`,
    '     Anything inside an HTML comment is stripped. Write the summary for a reader of',
    '     the app, not for a reader of the git log. -->',
    '',
    'Write two or three sentences here about what actually changed for the reader.',
    '',
    '## Changes',
    '',
    ...subjects.map((s) => `- ${s}`),
    '',
    `<!-- ${subjects.length} commits since ${previousTag ?? 'the beginning'} -->`,
    '',
  ].join('\n')
  mutate(`write ${path.relative(repoRoot, notesPath)}`, () => fs.writeFileSync(notesPath, draft, 'utf8'))
  info(`drafted ${subjects.length} commits since ${previousTag ?? 'the beginning'}`)
}

info(`Notes file: ${bold(path.relative(repoRoot, notesPath))}`)
await pause('Edit the notes now, then press Enter to continue (Ctrl+C to abort)...')

const rawNotes = fs.existsSync(notesPath) ? fs.readFileSync(notesPath, 'utf8') : ''
const notesBody = rawNotes.replace(/<!--[\s\S]*?-->/g, '').trim()
if (!notesBody && !DRY_RUN) die('the release notes file is empty')

// ------------------------------------------------------- 4. cross-platform gate

phase('Cross-platform gate')

// The release ships main's tip (preflight requires the checkout to be it), so
// the gate is a CI run for that exact commit (the push run, or a dispatched
// one): verify (every app's types,
// lint, tests and web builds) and then the Android build. A release is public
// facing, so it never starts on less (CLAUDE.md, "Git workflow"). The run
// already exists, because pushing to main started it; this only reads its
// answer, waiting for it if it is still running.
const gateSha = git('rev-parse', 'HEAD')
if (DRY_RUN) {
  info(dim(`[dry-run] would require CI to be green on ${gateSha.slice(0, 7)}`))
} else {
  const res = ghQuiet('run', 'list', '--workflow', 'ci.yml', '--commit', gateSha,
    '--limit', '1', '--json', 'databaseId,status,conclusion,url')
  const ciRun = res.status === 0 && res.stdout ? JSON.parse(res.stdout)[0] : undefined
  if (!ciRun) {
    die(`no CI run for ${gateSha.slice(0, 7)}`,
      'Every push to main starts one (.github/workflows/ci.yml). Start it with\n' +
      '  gh workflow run ci.yml --ref main\nthen re-run this command.')
  }
  info(ciRun.url)
  if (ciRun.status !== 'completed') {
    info('CI is still running -- waiting for its answer...')
    run('gh', ['run', 'watch', String(ciRun.databaseId), '--exit-status'], { allowFail: true })
  }
  const { conclusion } = JSON.parse(gh('run', 'view', String(ciRun.databaseId), '--json', 'conclusion'))
  if (conclusion !== 'success') die(`CI concluded "${conclusion}" on ${gateSha.slice(0, 7)}`, 'Fix main first; nothing was tagged.')
  ok('CI is green on this commit, Android build included')
}

// ------------------------------------------------------- 5. bump, tag, push

phase('Bump, tag, push')

if (tagExists) {
  ok(`${tag} already tagged -- skipping bump`)
} else {
  mutate(`set version to ${version} in apps/notes/package.json and package-lock.json`, () => {
    pkg.version = version
    fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')

    // Keep the lockfile's version fields in step, so `npm ci` in CI installs
    // against a lockfile that agrees with the manifest.
    const lockPath = path.join(repoRoot, 'package-lock.json')
    if (fs.existsSync(lockPath)) {
      const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
      if (lock.packages?.['apps/notes']) lock.packages['apps/notes'].version = version
      fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8')
    }
  })

  // The changelog is the release notes, kept: the notes file is a draft in an
  // ignored folder, and this entry is what stays in the repository.
  mutate(`add ${version} to apps/notes/CHANGELOG.md`, () => {
    const date = new Date().toISOString().slice(0, 10)
    const log = fs.readFileSync(changelogPath, 'utf8')
    // A run that wrote the entry and then stopped before committing must not
    // write it twice.
    if (log.includes(`\n## ${version} (`)) return
    const marker = log.indexOf('\n## ')
    const head = marker === -1 ? `${log.trimEnd()}\n` : log.slice(0, marker + 1)
    const rest = marker === -1 ? '' : log.slice(marker + 1)
    const body = notesBody.replace(/^(#+) /gm, '##$1 ')
    fs.writeFileSync(changelogPath, `${head}\n## ${version} (${date})\n\n${body}\n\n${rest}`.replace(/\n{3,}/g, '\n\n'), 'utf8')
  })

  mutate(`commit and tag ${tag}`, () => {
    run('git', ['add', 'apps/notes/package.json', 'package-lock.json', 'apps/notes/CHANGELOG.md'])
    run('git', ['commit', '-m', `Release ${tag}`])
    run('git', ['tag', '-a', tag, '-m', `Thockdown Notes ${tag}`])
  })

  // The point of no return: pushing the tag starts the macOS build.
  mutate('push main and the tag to origin', () => {
    run('git', ['push', 'origin', 'main'])
    run('git', ['push', 'origin', tag])
  })
  ok(`${tag} pushed -- the macOS build has started`)
}

// ------------------------------------------------------- 6. create release

phase('GitHub prerelease')

const releaseExists = ghQuiet('release', 'view', tag).status === 0

if (releaseExists) {
  ok(`release ${tag} already exists`)
  mutate('refresh its notes from the notes file', () =>
    run('gh', ['release', 'edit', tag, '--notes-file', notesPath, '--prerelease']))
} else {
  // Continue this app's "Alpha Release #N" numbering without anyone having to
  // count; another app's releases are not part of the sequence.
  const existingTitles = ghQuiet('release', 'list', '--limit', '100', '--json', 'name,tagName')
  let nextNumber = 1
  if (existingTitles.status === 0 && existingTitles.stdout) {
    const numbers = JSON.parse(existingTitles.stdout)
      .filter((r) => isReleaseTag(r.tagName ?? ''))
      .map((r) => /Alpha Release #(\d+)/.exec(r.name ?? '')?.[1])
      .filter(Boolean)
      .map(Number)
    if (numbers.length) nextNumber = Math.max(...numbers) + 1
  }
  const title = `Alpha Release #${nextNumber}`
  info(`title: ${bold(title)}`)
  mutate(`create prerelease ${tag}`, () =>
    run('gh', ['release', 'create', tag, '--prerelease', '--title', title, '--notes-file', notesPath]))
  ok('prerelease created')
}

// ------------------------------------------------------- 7. windows build

phase('Windows build (local)')

const outDir = path.join(appDir, 'release', version)
const findWindowsArtifacts = () => {
  if (!fs.existsSync(outDir)) return []
  return fs
    .readdirSync(outDir)
    .filter((f) => /\.(exe|zip)$/i.test(f))
    .map((f) => path.join(outDir, f))
}

let windowsArtifacts = findWindowsArtifacts()
if (windowsArtifacts.length >= 2) {
  ok(`reusing the existing build in apps/notes/release/${version}`)
} else if (DRY_RUN) {
  info(dim('[dry-run] would run npm run build'))
} else {
  info('running npm run build (installer + portable) -- this takes a few minutes')
  run('npm', ['run', 'build'])
  windowsArtifacts = findWindowsArtifacts()
}

if (!DRY_RUN) {
  if (!windowsArtifacts.length) die(`no .exe/.zip artifacts found in apps/notes/release/${version}`)
  for (const f of windowsArtifacts) {
    const mb = (fs.statSync(f).size / 1024 / 1024).toFixed(1)
    ok(`${path.basename(f)} ${dim(`(${mb} MB)`)}`)
  }
}

// ------------------------------------------------------- 8. wait for macOS

phase('macOS build (GitHub Actions)')

if (DRY_RUN) {
  info(dim('[dry-run] would wait for the build-mac workflow'))
} else {
  // Does the release already carry a DMG?  If a previous attempt got that far,
  // there is nothing to wait for.
  const existingAssets = ghQuiet('release', 'view', tag, '--json', 'assets')
  const hasDmg = existingAssets.status === 0 && existingAssets.stdout
    ? JSON.parse(existingAssets.stdout).assets.some((a) => a.name.endsWith('.dmg'))
    : false

  const listRuns = () => {
    const res = ghQuiet('run', 'list', '--workflow', 'build-mac.yml', '--limit', '15',
      '--json', 'databaseId,status,conclusion,url,headBranch,displayTitle,createdAt')
    return res.status === 0 && res.stdout ? JSON.parse(res.stdout) : []
  }
  // A tag push names the run's headBranch after the tag; a dispatch carries the
  // tag in its display title instead.
  const runsForTag = () => listRuns().filter((r) => r.headBranch === tag || (r.displayTitle ?? '').includes(tag))

  let macRun = runsForTag()[0]

  if (hasDmg && (!macRun || macRun.status === 'completed')) {
    ok('the release already carries a DMG')
  } else {
    if (!macRun || macRun.conclusion === 'failure' || macRun.conclusion === 'cancelled') {
      // Dispatch from main so the *current* workflow file runs -- a tag's own
      // copy is frozen, so a pipeline fixed after tagging can never re-run
      // itself.  The `tag` input still points the build at the tagged source.
      info(macRun ? 'the previous run failed -- dispatching a fresh one' : 'no run found for this tag -- dispatching one')
      mutate('dispatch the build-mac workflow', () =>
        run('gh', ['workflow', 'run', 'build-mac.yml', '--ref', 'main', '-f', `tag=${tag}`]))
      const startedAt = Date.now()
      const previousId = macRun?.databaseId
      while (Date.now() - startedAt < 60_000) {
        const candidate = runsForTag()[0]
        if (candidate && candidate.databaseId !== previousId) { macRun = candidate; break }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000)
      }
    }

    if (!macRun) {
      warn('the workflow was dispatched but no run appeared -- re-run this script shortly')
    } else {
      info(macRun.url)
      if (macRun.status !== 'completed') {
        info('waiting for it to finish (usually 3-4 minutes)...')
        run('gh', ['run', 'watch', String(macRun.databaseId), '--exit-status'], { allowFail: true })
      }
      const after = JSON.parse(gh('run', 'view', String(macRun.databaseId), '--json', 'conclusion'))
      if (after.conclusion === 'success') ok('macOS DMG built and attached')
      else warn(`macOS build concluded "${after.conclusion}" -- the release will ship without a DMG`)
    }
  }
}

// ------------------------------------------------------- 9. upload + verify

phase('Upload and verify')

if (DRY_RUN) {
  info(dim('[dry-run] would upload the Windows artifacts and verify every checksum'))
} else {
  run('gh', ['release', 'upload', tag, ...windowsArtifacts, '--clobber'])
  ok('Windows artifacts uploaded')

  // Verification, end to end.  We hash the Windows files here; GitHub hashes
  // every asset on its own side and reports it as `digest`.  If the two agree,
  // the bytes a user downloads are the bytes this machine built.  For the DMG
  // -- which this machine never had -- the mac runner's own .sha256 sidecar
  // plays the role of the local hash, so it is checked the same way without
  // pulling 200+ MB back down.
  // GitHub rewrites spaces in an uploaded asset's filename to dots, so
  // "Thockdown Notes-...exe" comes back as "Thockdown.Notes-...exe".  Key both
  // sides on the same normalized name, or nothing ever matches and the whole
  // verification degrades into a row of "no local hash" notes -- which is
  // exactly how it shipped the first time.
  const assetKey = (name) => name.replace(/\s+/g, '.')
  const localHashes = new Map(windowsArtifacts.map((f) => [assetKey(path.basename(f)), sha256(f)]))

  const verifyDir = path.join(outDir, 'verify')
  fs.rmSync(verifyDir, { recursive: true, force: true })
  const sidecar = ghQuiet('release', 'download', tag, '--pattern', '*.dmg.sha256', '--dir', verifyDir)
  if (sidecar.status === 0 && fs.existsSync(verifyDir)) {
    for (const f of fs.readdirSync(verifyDir)) {
      // "<hash>  <filename>", and the filename contains spaces ("Thockdown
      // Notes-Mac-..."), so split on the *first* run of whitespace only.
      const line = fs.readFileSync(path.join(verifyDir, f), 'utf8').trim()
      const parsed = /^(\S+)\s+(.+)$/.exec(line)
      if (parsed) localHashes.set(assetKey(parsed[2]), parsed[1].toLowerCase())
      else warn(`could not parse checksum sidecar ${f}`)
    }
  } else {
    warn('no DMG checksum sidecar on the release -- the DMG could not be verified')
  }

  const assets = JSON.parse(gh('release', 'view', tag, '--json', 'assets')).assets
  let mismatches = 0
  const sums = []
  for (const asset of assets) {
    if (asset.name.endsWith('.sha256') || asset.name === 'SHA256SUMS.txt') continue
    const remote = (asset.digest ?? '').replace(/^sha256:/, '').toLowerCase()
    const local = localHashes.get(assetKey(asset.name))
    if (!remote) {
      warn(`${asset.name}: GitHub reported no digest`)
      continue
    }
    sums.push(`${remote}  ${asset.name}`)
    if (!local) {
      info(`${dim('--')}  ${asset.name} ${dim('(no local hash to compare against)')}`)
      continue
    }
    if (local === remote) ok(`${asset.name} verified`)
    else {
      console.error(`    ${red('XX')}  ${asset.name}: local ${local} != GitHub ${remote}`)
      mismatches++
    }
  }
  if (mismatches) die(`${mismatches} asset(s) failed checksum verification`, 'Do not publish this release.')

  // Ship the checksums so a user can verify their own download.
  const sumsPath = path.join(outDir, 'SHA256SUMS.txt')
  fs.writeFileSync(sumsPath, `${sums.sort().join('\n')}\n`, 'utf8')
  run('gh', ['release', 'upload', tag, sumsPath, '--clobber'])
  ok('SHA256SUMS.txt published')

  fs.rmSync(verifyDir, { recursive: true, force: true })
}

// ------------------------------------------------------- done

phase('Done')

const repo = ghQuiet('repo', 'view', '--json', 'url')
const repoUrl = repo.status === 0 && repo.stdout ? JSON.parse(repo.stdout).url : ''
console.log(`
    ${green(bold(`Thockdown Notes ${tag} is staged as a prerelease.`))}

    ${repoUrl}/releases/tag/${tag}

    Last human step: open the release, read it once, add a screenshot if this
    one deserves it. It stays a prerelease until you say otherwise.
`)
