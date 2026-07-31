#!/usr/bin/env node
// Live-browser regression check: adding/removing a tag on the active note
// must not permanently hide the caret. Root cause: EditorSection.tsx's
// activateNote() unconditionally called setIsCaretSuspended(true), but the
// note-activation effect (useEditorSectionMount.ts) deliberately skips
// re-restoring -- and therefore never calls setIsCaretSuspended(false) --
// when activateNote() is called with the *same* noteId, which is exactly
// what runActiveNoteTagMutation (useSectionTabs.ts) does after a tag
// mutation, to refresh the note's tag list. Fixed by only suspending the
// caret on an actual note switch.
//
//   node scripts/perf/verifyCM6CaretSurvivesTagMutation.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 5191;

function resolveChromiumExecutablePath() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!browsersRoot || !existsSync(browsersRoot)) return undefined;
  const chromiumDir = readdirSync(browsersRoot).find((name) => name.startsWith('chromium-'));
  if (!chromiumDir) return undefined;
  const candidate = path.join(browsersRoot, chromiumDir, 'chrome-linux', 'chrome');
  return existsSync(candidate) ? candidate : undefined;
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return;
    } catch { /* keep polling */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Dev server at ${url} did not become ready in ${timeoutMs}ms`);
}

function assertTrue(cond, label) {
  if (!cond) throw new Error(`FAIL: ${label}`);
  console.log(`  ok  ${label}`);
}

const proc = spawn('npm', ['run', 'dev:browser', '--', '--port', String(PORT), '--strictPort'], {
  cwd: REPO_ROOT, stdio: 'ignore', detached: true,
});

async function main() {
  await waitForServer(`http://localhost:${PORT}/`, 30000);

  const browser = await chromium.launch({ headless: true, executablePath: resolveChromiumExecutablePath() });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('.editor-text[contenteditable="true"]', { timeout: 15000 });

  await page.evaluate(async () => {
    const note = await window.thockdownNotes.createNote({ initialText: 'Tag mutation caret check' });
    await window.thockdownSections.setActiveNote('default', note.id);
  });
  await page.reload();
  await page.waitForSelector('.editor-text[contenteditable="true"]', { timeout: 15000 });
  await page.waitForTimeout(400);

  const line = page.locator('.cm-line').first();
  await line.click({ position: { x: 5, y: 5 } });
  await page.waitForTimeout(200);
  assertTrue(await page.locator('.thockdown-block-caret').count() > 0, 'caret visible before any tag mutation');

  // Switch the tab bar into tag-manager mode, same as a user clicking the
  // tag icon, then type a new tag and press Enter -- the real UI path
  // handleTagInputEnter -> runActiveNoteTagMutation -> activateNote(sameId)
  // goes through, same one a suggested-tag-pill click or chip removal uses.
  await page.click('.tagbar-toggle');
  await page.waitForSelector('.tabbar-tag-input-field', { timeout: 5000 });
  await page.fill('.tabbar-tag-input-field', 'demo-tag');
  await page.press('.tabbar-tag-input-field', 'Enter');
  await page.waitForTimeout(500);

  await page.click('.cm-line >> nth=0', { position: { x: 5, y: 5 } });
  await page.waitForTimeout(200);
  assertTrue(await page.locator('.thockdown-block-caret').count() > 0, 'caret still visible after adding a tag by typing (no note reload)');

  // Now remove it: first click primes, second click removes -- same
  // runActiveNoteTagMutation -> activateNote(sameId) path. Clicking into
  // the editor above dropped the tab bar back out of tag-manager mode
  // (click-outside-closes-tag-bar), so re-enter it first.
  await page.click('.tagbar-toggle');
  await page.waitForSelector('.tag-pill.active', { timeout: 5000 });
  await page.locator('.tag-pill.active', { hasText: 'demo-tag' }).click();
  await page.waitForTimeout(150);
  await page.locator('.tag-pill.active', { hasText: 'demo-tag' }).click();
  await page.waitForTimeout(500);

  await page.click('.cm-line >> nth=0', { position: { x: 5, y: 5 } });
  await page.waitForTimeout(200);
  assertTrue(await page.locator('.thockdown-block-caret').count() > 0, 'caret still visible after removing the tag (no note reload)');

  assertTrue(consoleErrors.length === 0, `no console errors (saw: ${JSON.stringify(consoleErrors)})`);

  console.log('\n[verify] ALL CHECKS PASSED');
  await browser.close();
  process.kill(-proc.pid);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  try { process.kill(-proc.pid); } catch { /* already gone */ }
  process.exit(1);
});
