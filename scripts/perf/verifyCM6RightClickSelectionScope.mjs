#!/usr/bin/env node
// Live-browser regression check for CM6Editor.tsx's right-click
// selection-scope cycling (word -> sentence -> line -> block on repeated
// right-clicks in the same spot, reset by an intervening left-click) --
// ported from ContractBridgePlugin.tsx's (Lexical) handleContextMenu, see
// docs/cm6-parity-hardening-plan.md Bug 1. Matches this project's other
// scripts/perf/verifyCM6*.mjs regression scripts in shape: `npm run
// dev:browser`, real Chromium via Playwright, asserts against the real DOM
// selection rather than reasoning about the code.
//
//   node scripts/perf/verifyCM6RightClickSelectionScope.mjs
import { chromium } from 'playwright';
import path from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { startDevServer, waitForAppReady, ensureEditMode } from './perfHarness.mjs';

const PORT = 5183;

function resolveChromiumExecutablePath() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!browsersRoot || !existsSync(browsersRoot)) return undefined;
  const chromiumDir = readdirSync(browsersRoot).find((name) => name.startsWith('chromium-'));
  if (!chromiumDir) return undefined;
  const candidate = path.join(browsersRoot, chromiumDir, 'chrome-linux', 'chrome');
  return existsSync(candidate) ? candidate : undefined;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  console.log(`  ok  ${label}: ${JSON.stringify(actual)}`);
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

  const text = 'The quick brown fox jumps. Over the lazy dog! Here is another sentence.\nSecond line of the paragraph continues here.\n\nA second paragraph block starts here with more words to select.';
  await page.evaluate(async (initialText) => {
    const note = await window.thockdownNotes.createNote({ initialText });
    await window.thockdownSections.setActiveNote('default', note.id);
  }, text);
  await page.reload();
  await ensureEditMode(page);
  await page.waitForTimeout(500);

  const wordLocator = page.locator('.cm-line', { hasText: 'brown fox' }).first();
  const lineBox = await wordLocator.boundingBox();
  if (!lineBox) throw new Error('could not find target line');

  // Calibrate an exact on-screen point inside the word "fox" via native
  // double-click-selects-word (CM6 doesn't suppress this, unlike Lexical) --
  // more reliable than estimating pixels-per-character by hand.
  async function readNativeSelection() {
    return page.evaluate(() => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return null;
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      return { text: sel.toString(), x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
  }

  let calibrated = null;
  for (let attempt = 0; attempt < 20 && calibrated?.text !== 'fox'; attempt += 1) {
    const x = lineBox.x + lineBox.width * (0.2 + attempt * 0.03);
    await page.mouse.dblclick(x, lineBox.y + lineBox.height / 2);
    await page.waitForTimeout(80);
    calibrated = await readNativeSelection();
  }
  if (calibrated?.text !== 'fox') {
    throw new Error(`could not calibrate onto "fox", last got: ${JSON.stringify(calibrated)}`);
  }
  const targetX = calibrated.x;
  const targetY = calibrated.y;

  async function rightClickAndReadSelection() {
    await page.mouse.click(targetX, targetY, { button: 'right' });
    await page.waitForTimeout(150);
    return page.evaluate(() => window.getSelection()?.toString() ?? '');
  }

  console.log('Right-click scope cycling:');
  assertEqual(await rightClickAndReadSelection(), 'fox', 'click 1 (word)');
  assertEqual(await rightClickAndReadSelection(), 'The quick brown fox jumps.', 'click 2 (sentence)');
  assertEqual(
    await rightClickAndReadSelection(),
    'The quick brown fox jumps. Over the lazy dog! Here is another sentence.',
    'click 3 (line)',
  );
  assertEqual(
    await rightClickAndReadSelection(),
    'The quick brown fox jumps. Over the lazy dog! Here is another sentence.\nSecond line of the paragraph continues here.',
    'click 4 (block)',
  );
  assertEqual(
    await rightClickAndReadSelection(),
    'The quick brown fox jumps. Over the lazy dog! Here is another sentence.\nSecond line of the paragraph continues here.',
    'click 5 (stays at block, no further scope to advance to)',
  );

  // An intervening left-click (still on real text) resets the cycle so the
  // next right-click starts fresh at 'word'.
  await page.mouse.click(lineBox.x + 5, lineBox.y + lineBox.height / 2);
  await page.waitForTimeout(100);
  assertEqual(await rightClickAndReadSelection(), 'fox', 'click 6, after left-click reset (word again)');

  if (consoleErrors.length > 0) {
    throw new Error(`Console errors during test:\n${consoleErrors.join('\n')}`);
  }

  console.log('\nAll checks passed, zero console errors.');
  await browser.close();
}

main()
  .then(() => {
    server?.stop();
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    server?.stop();
    process.exit(1);
  });
