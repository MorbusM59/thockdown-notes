#!/usr/bin/env node
// Live-browser regression check: the caret stays where the reader left it.
//
// 1. A note that has never recorded a caret opens with the caret at its END.
//    The rule was always in EditRestoreMath, and never applied: the store
//    read "no caret" back as 0 and a launch migration rewrote it to 0.
// 2. Changing the line height (Ctrl+Shift+wheel) while typing does not move
//    the caret. The Time Machine restore effect in useEditorSectionMount.ts
//    re-ran whenever its callbacks changed identity -- applyEditRestoreSnapshot
//    follows lineHeightPx -- and re-applied the note's cached position, which
//    typing had never refreshed, so the caret jumped back to where typing
//    began and the next save stored it there. (A dev hot update did the same,
//    which is how it was found.)
//
//   node scripts/perf/verifyCaretSurvivesRestoreReruns.mjs
import { chromium } from 'playwright';
import path from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { startDevServer, waitForAppReady, ensureEditMode } from './perfHarness.mjs';

const PORT = 5193;
const NOTE_TEXT = 'Caret check\n\nThe caret should start after this line.';

function resolveChromiumExecutablePath() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!browsersRoot || !existsSync(browsersRoot)) return undefined;
  const chromiumDir = readdirSync(browsersRoot).find((name) => name.startsWith('chromium-'));
  if (!chromiumDir) return undefined;
  const candidate = path.join(browsersRoot, chromiumDir, 'chrome-linux', 'chrome');
  return existsSync(candidate) ? candidate : undefined;
}

function assertTrue(cond, label) {
  if (!cond) throw new Error(`FAIL: ${label}`);
  console.log(`  ok  ${label}`);
}

const editorText = (page) => page.evaluate(() => document.querySelector('.cm-content').innerText.replace(/\n+$/, ''));

let server;

async function main() {
  server = await startDevServer(PORT);

  const browser = await chromium.launch({ headless: true, executablePath: resolveChromiumExecutablePath() });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));

  await page.goto(`http://localhost:${PORT}/`);
  await waitForAppReady(page);

  await page.evaluate(async (initialText) => {
    const note = await window.thockdownNotes.createNote({ initialText });
    await window.thockdownSections.setActiveNote('default', note.id);
  }, NOTE_TEXT);
  await page.reload();
  await ensureEditMode(page);
  await page.waitForTimeout(600);

  // No click: a click places the caret itself. The keyboard is in the editor
  // from boot (focusOwnership's reconciler), so this types wherever the
  // restore put the caret.
  await page.keyboard.type('A');
  await page.waitForTimeout(300);
  assertTrue((await editorText(page)).endsWith('after this line.A'), 'a note with no recorded caret opens with the caret at its end');

  await page.keyboard.type(' typed\nmore typing');
  await page.waitForTimeout(500);
  const box = await page.locator('.cm-content').first().boundingBox();
  await page.mouse.move(box.x + 50, box.y + 50);
  const lineHeightBefore = await page.evaluate(() => getComputedStyle(document.querySelector('.cm-line')).lineHeight);
  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  for (let step = 0; step < 3; step += 1) {
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(150);
  }
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  await page.waitForTimeout(1200);
  const lineHeightAfter = await page.evaluate(() => getComputedStyle(document.querySelector('.cm-line')).lineHeight);
  assertTrue(lineHeightBefore !== lineHeightAfter, `the line height changed (${lineHeightBefore} -> ${lineHeightAfter})`);

  await page.keyboard.type('Z');
  await page.waitForTimeout(300);
  assertTrue((await editorText(page)).endsWith('more typingZ'), 'typing after a line-height change continues at the caret');

  assertTrue(pageErrors.length === 0, `no uncaught errors (saw: ${JSON.stringify(pageErrors)})`);

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
