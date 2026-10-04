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
import path from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { startDevServer, waitForAppReady, ensureEditMode } from './perfHarness.mjs';

const PORT = 5191;

function resolveChromiumExecutablePath() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!browsersRoot || !existsSync(browsersRoot)) return undefined;
  const chromiumDir = readdirSync(browsersRoot).find((name) => name.startsWith('chromium-'));
  if (!chromiumDir) return undefined;
  const candidate = path.join(browsersRoot, chromiumDir, 'chrome-linux', 'chrome');
  return existsSync(candidate) ? candidate : undefined;
}

/**
 * Puts the tab bar into tag-manager mode, whichever mode it happens to start
 * in. Asked as a question about what is on screen rather than as a blind
 * click: the bar's default mode has flipped at least once, and a script that
 * assumes it starts in chapter mode toggles tags OFF and then waits forever
 * for the input it just closed. The toggle is addressed by its user-visible
 * label because the `.tagbar-toggle` class this used to click is now dead CSS
 * matching nothing at all -- a selector that rots silently.
 */
async function ensureTagBarMode(page) {
  const input = page.locator('.tabbar-tag-input-field');
  if (await input.isVisible().catch(() => false)) return;
  await page.click('[aria-label="Show tags"]');
  await input.waitFor({ state: 'visible', timeout: 5000 });
}

function assertTrue(cond, label) {
  if (!cond) throw new Error(`FAIL: ${label}`);
  console.log(`  ok  ${label}`);
}

let server;

async function main() {
  server = await startDevServer(PORT);

  const browser = await chromium.launch({ headless: true, executablePath: resolveChromiumExecutablePath() });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  await page.goto(`http://localhost:${PORT}/`);
  await waitForAppReady(page);

  await page.evaluate(async () => {
    const note = await window.thockdownNotes.createNote({ initialText: 'Tag mutation caret check' });
    await window.thockdownSections.setActiveNote('default', note.id);
  });
  await page.reload();
  await ensureEditMode(page);
  await page.waitForTimeout(400);

  const line = page.locator('.cm-line').first();
  await line.click({ position: { x: 5, y: 5 } });
  await page.waitForTimeout(200);
  assertTrue(await page.locator('.thockdown-block-caret').count() > 0, 'caret visible before any tag mutation');

  // Tag-manager mode, then type a new tag and press Enter -- the real UI
  // path handleTagInputEnter -> runActiveNoteTagMutation ->
  // activateNote(sameId) goes through, same one a suggested-tag-pill click or
  // chip removal uses.
  await ensureTagBarMode(page);
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
  await ensureTagBarMode(page);
  await page.waitForSelector('.tag-pill.is-active', { timeout: 5000 });
  await page.locator('.tag-pill.is-active', { hasText: 'demo-tag' }).click();
  await page.waitForTimeout(150);
  await page.locator('.tag-pill.is-active', { hasText: 'demo-tag' }).click();
  await page.waitForTimeout(500);

  await page.click('.cm-line >> nth=0', { position: { x: 5, y: 5 } });
  await page.waitForTimeout(200);
  assertTrue(await page.locator('.thockdown-block-caret').count() > 0, 'caret still visible after removing the tag (no note reload)');

  assertTrue(consoleErrors.length === 0, `no console errors (saw: ${JSON.stringify(consoleErrors)})`);

  console.log('\n[verify] ALL CHECKS PASSED');
  await browser.close();
  server?.stop();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  server?.stop();
  process.exit(1);
});
