// The one definition of "green" (CLAUDE.md, "Git workflow"), in two scopes.
//
// FULL (`npm run verify`): what CI runs on every push and pull request
// (.github/workflows/ci.yml) and what a release requires. Every app is checked
// on every change, because shared code reaches all of them: the desktop's and
// the mobile app's types, the linter, the whole test suite, and both apps' web
// builds (the Electron main/preload/renderer bundles, the mobile web app and
// the sandbox renderer bundle). Packaging (electron-builder, Gradle) is not
// here: Gradle needs the Android SDK, so CI runs it as a job after this one.
//
// SCOPED (`npm run verify -- --since <ref>`, what `npm run land` runs): the
// same steps, with only the two whose cost does not follow the change cut down
// to what the change can reach. Nothing is chosen by judgement:
//   - types and builds stay whole. They are cheap (seconds) and are what sees
//     a change break a caller in another file, CSS and assets included.
//   - lint runs on the changed TypeScript files. The configuration has no
//     type-aware rule, so a file's lint result depends on that file alone.
//   - tests are `vitest related`: every test whose import graph reaches a
//     changed file, so touching a core module pulls in everything built on it
//     and the cost grows with the change's reach on its own.
// WHAT A TEST READS FROM DISK is outside any import graph, so every module
// under apps/ or packages/ that imports `fs` -- a test, or a helper a test
// imports, which reads on the test's behalf -- DECLARES it on its first line,
// and verify (either scope) fails on one that does not -- a declaration cannot be forgotten, a detection
// heuristic can be fooled:
//   `// verify: reads-repository` -- sources or assets anywhere in the repo
//     (the contract tests that parse every component): always runs.
//   `// verify: reads-siblings` -- files in its own directory (a fixture, a
//     stylesheet): runs when anything in that directory changed.
//   `// verify: reads-temp` -- nothing committed (files a test wrote, the
//     user's data): the import graph alone decides.
// A selected module that is not a test is handed to `vitest related` as one
// more root, so the tests importing it run.
// A change touching anything outside apps/ and packages/ (root configuration,
// the scripts, the lockfile) is not scoped at all: it runs FULL. CI runs FULL
// on main after every landing either way, so scoped is a fast gate and never
// the last word.
//
// Steps run in order and stop at the first failure, naming it.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { changedPaths } from './impact.mjs'

const sinceAt = process.argv.indexOf('--since')
const since = sinceAt >= 0 ? process.argv[sinceAt + 1] : null
if (sinceAt >= 0 && !since) {
  console.error('verify: --since needs a ref')
  process.exit(1)
}

const IMPORTS_FS = /from ['"](node:)?fs(\/promises)?['"]|require\(['"](node:)?fs(\/promises)?['"]\)|import\(['"](node:)?fs(\/promises)?['"]\)/
const DECLARATION = /^\/\/ verify: (reads-repository|reads-siblings|reads-temp)\b/

function trackedModules() {
  const res = spawnSync('git', ['ls-files', 'apps/*.ts', 'apps/*.tsx', 'packages/*.ts', 'packages/*.tsx'], { encoding: 'utf8' })
  if (res.status !== 0) throw new Error(`git ls-files failed: ${res.stderr.trim()}`)
  return res.stdout.split('\n').filter(Boolean)
}

/** Each module that imports `fs`, with what it declares it reads. Fails on an undeclared one. */
function diskReaders() {
  const readers = []
  const undeclared = []
  for (const file of trackedModules()) {
    const text = readFileSync(file, 'utf8')
    if (!IMPORTS_FS.test(text)) continue
    const kind = DECLARATION.exec(text)?.[1]
    if (kind) readers.push({ file, kind })
    else undeclared.push(file)
  }
  if (undeclared.length) {
    console.error('verify: these modules import fs without declaring what they read (see scripts/verify.mjs):')
    for (const f of undeclared) console.error(`  ${f}`)
    process.exit(1)
  }
  return readers
}

/** null means "run full"; otherwise the scoped lint and test arguments. */
function scopeOf(ref, readers) {
  const changed = changedPaths(ref, 'HEAD')
  const outside = changed.filter((p) => !/^(apps|packages)\//.test(p) && !/^[^/]+\.md$|^docs\//.test(p))
  if (outside.length) {
    console.log(`verify: touches ${outside.join(', ')} -- running FULL`)
    return null
  }
  const present = changed.filter((p) => existsSync(p))
  const lint = present.filter((p) => /\.tsx?$/.test(p))
  const dirs = new Set(changed.map((p) => dirname(p)))
  const diskTests = readers
    .filter(({ file, kind }) => kind === 'reads-repository' || (kind === 'reads-siblings' && dirs.has(dirname(file))))
    .map(({ file }) => file)
  const sources = present.filter((p) => !/\.md$/.test(p))
  return { lint, tests: [...new Set([...sources, ...diskTests])] }
}

const readers = diskReaders()
const scope = since ? scopeOf(since, readers) : null
if (scope) console.log(`verify: SCOPED to the change since ${since} (${scope.lint.length} files to lint, ${scope.tests.length} test roots)`)

const lintStep = !scope
  ? ['lint', 'npm', ['run', 'lint', '--silent']]
  : scope.lint.length
    ? ['lint (changed files)', 'npx', ['eslint', '--report-unused-disable-directives', '--max-warnings', '0', ...scope.lint]]
    : null
const testStep = !scope
  ? ['tests', 'npx', ['vitest', 'run']]
  : ['tests (related)', 'npx', ['vitest', 'related', '--run', '--passWithNoTests', ...scope.tests]]

const steps = [
  ['types: desktop', 'npx', ['tsc', '--noEmit', '-p', 'apps/notes']],
  ['types: mobile', 'npx', ['tsc', '--noEmit', '-p', 'apps/soundscapes']],
  lintStep,
  testStep,
  ['build: desktop', 'npx', ['vite', 'build', '--config', 'apps/notes/vite.config.ts']],
  ['build: mobile web app', 'npx', ['vite', 'build', '--config', 'apps/soundscapes/vite.config.ts']],
  ['build: mobile sandbox renderer', 'npx', ['vite', 'build', '--config', 'apps/soundscapes/vite.renderer.config.ts']],
].filter(Boolean)

for (const [name, command, args] of steps) {
  console.log(`\n== verify: ${name}`)
  const started = Date.now()
  const { status } = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' })
  if (status !== 0) {
    console.error(`\nverify FAILED at "${name}"`)
    process.exit(status ?? 1)
  }
  console.log(`== ${name}: ok (${((Date.now() - started) / 1000).toFixed(1)}s)`)
}
console.log(`\nverify: all green${scope ? ' (scoped; CI runs the full check on main)' : ''}`)
