// The one definition of "green" (CLAUDE.md, "Git workflow"): what a
// session runs before a change reaches main, and what CI runs on every push
// and pull request (.github/workflows/ci.yml). Every app is checked on every
// change, because shared code reaches all of them: the desktop's and the
// mobile app's types, the linter, the whole test suite, and both apps' web
// builds (the Electron main/preload/renderer bundles, the mobile web app and
// the sandbox renderer bundle). Packaging (electron-builder, Gradle) is not
// here: Gradle needs the Android SDK, so CI runs it as a job after this one.
//
// Steps run in order and stop at the first failure, naming it.
import { spawnSync } from 'node:child_process'

const steps = [
  ['types: desktop', 'npx', ['tsc', '--noEmit', '-p', 'apps/notes']],
  ['types: mobile', 'npx', ['tsc', '--noEmit', '-p', 'apps/soundscapes']],
  ['lint', 'npm', ['run', 'lint', '--silent']],
  ['tests', 'npx', ['vitest', 'run']],
  ['build: desktop', 'npx', ['vite', 'build', '--config', 'apps/notes/vite.config.ts']],
  ['build: mobile web app', 'npx', ['vite', 'build', '--config', 'apps/soundscapes/vite.config.ts']],
  ['build: mobile sandbox renderer', 'npx', ['vite', 'build', '--config', 'apps/soundscapes/vite.renderer.config.ts']],
]

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
console.log('\nverify: all green')
