// Vitest's globalSetup -- guaranteed to run before any test file regardless
// of how vitest itself was invoked (`npm test`, a bare `npx vitest run
// <file>`, an IDE's own test runner, ...). package.json's `pretest` hook
// (kill stray Electron + `npm rebuild better-sqlite3`) only fires for `npm
// test`/`npm run test` specifically -- npm only runs `pre<script>` hooks for
// scripts invoked through npm itself, so anything that reaches vitest a
// different way skips it silently, leaving better-sqlite3 built for
// whichever runtime last touched it instead of the one about to run tests.
//
// better-sqlite3 is a native addon compiled against one specific runtime's
// ABI (NODE_MODULE_VERSION) at a time; this project's Electron main process
// and its own Node-run test suite need DIFFERENT builds of it
// (electron-rebuild vs. plain `npm rebuild`), so switching between "was
// developing in Electron last" and "run tests now" needs a rebuild every
// time regardless of entry point -- see killStrayElectronDev.mjs's own doc
// comment for why a leftover Electron process from an earlier dev session
// can also leave the native binary locked (EPERM) against that rebuild.
//
// Cheap common-case check first: an actual `new Database(':memory:')`, not
// just import success -- a mismatched build still resolves as a module and
// only throws once the native binary is actually dlopen'd (lazily, inside
// the Database constructor, not at require/import time -- confirmed live
// from this exact error's own stack trace). If it already works under the
// Node runtime this test run is using, this is a no-op. Only on a real
// mismatch does it fall back to the same kill-stray-Electron + rebuild
// package.json's pretest already does, then re-checks once more before
// giving up with a clear error instead of the raw NODE_MODULE_VERSION one.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(fileURLToPath(new URL('.', import.meta.url)));

async function betterSqlite3WorksForThisRuntime() {
  try {
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(':memory:');
    db.close();
    return true;
  } catch {
    return false;
  }
}

export default async function setup() {
  if (await betterSqlite3WorksForThisRuntime()) return;

  console.warn(
    '[vitest globalSetup] better-sqlite3 is built for a different runtime ' +
    '(most likely left over from an Electron dev session) -- rebuilding for ' +
    'Node before running tests...',
  );

  execFileSync(process.execPath, [path.join(projectRoot, 'scripts', 'killStrayElectronDev.mjs')], {
    stdio: 'inherit',
    cwd: projectRoot,
  });
  execFileSync('npm', ['rebuild', 'better-sqlite3'], {
    stdio: 'inherit',
    cwd: projectRoot,
    shell: true,
  });

  if (!(await betterSqlite3WorksForThisRuntime())) {
    throw new Error(
      'better-sqlite3 still fails to load under this Node runtime after an ' +
      'automatic rebuild -- see the rebuild output above for the actual ' +
      'cause (a file still locked by a process this script could not close, ' +
      'a missing native build toolchain, etc.).',
    );
  }
}
