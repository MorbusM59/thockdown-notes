// vite-plugin-electron spawns Electron as a plain child process of the vite
// dev server and relies on a clean parent shutdown (Ctrl+C / SIGINT) to kill
// it in turn. That only works for a graceful, interactive stop -- Windows has
// no real process-group cleanup, so any non-graceful exit of the dev server
// (terminal closed directly, background shell torn down, machine sleeping
// mid-session) leaves the Electron child running with nothing left to kill
// it. Those orphans hold better-sqlite3's native binary open, which then
// breaks `npm rebuild`/`electron-rebuild` with an EPERM file-lock error the
// next time either runs. Run before every `npm run dev`/`npm test` (see
// package.json's `predev`/`pretest`) to sweep away any stray Electron
// process from THIS project specifically, never touching Electron windows
// from other projects.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

if (process.platform !== 'win32') {
  // Non-Windows platforms propagate SIGINT/SIGTERM to child processes
  // through real process groups, so vite-plugin-electron's own cleanup
  // handles this case already.
  process.exit(0);
}

const projectRoot = process.cwd();

// Written out to a real .ps1 file and invoked with -File rather than
// -Command: the project path can contain characters (spaces, quotes) that
// are a nightmare to escape correctly through node -> cmd.exe -> powershell's
// own quoting layers, and a get-it-wrong-silently query is worse than doing
// nothing -- a file with PowerShell's own escaping only avoids that entirely.
const script = `
$root = [System.IO.Path]::GetFullPath('${projectRoot.replace(/'/g, "''")}')
Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" |
  Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) } |
  ForEach-Object {
    Write-Host "[killStrayElectronDev] Stopping leftover Electron process from a previous dev session: PID $($_.ProcessId)"
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
`;

const scratchDir = mkdtempSync(path.join(tmpdir(), 'kill-stray-electron-'));
const scriptPath = path.join(scratchDir, 'kill-stray-electron.ps1');

try {
  writeFileSync(scriptPath, script, 'utf8');
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], { stdio: 'inherit' });
} catch {
  // Best-effort -- never block `npm run dev`/`npm test` themselves over
  // cleanup failing (e.g. PowerShell unavailable, or a process too
  // privileged to stop).
} finally {
  rmSync(scratchDir, { recursive: true, force: true });
}
