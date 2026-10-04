#!/usr/bin/env node
// Live-browser regression check for the cursor/scroll persistence redesign
// (docs/cm6-parity-hardening-plan.md, "Cursor/scroll persistence redesign"
// section):
//
//  1. Typing alone -- with no explicit saveNoteUiState call -- piggybacks
//     the caret position onto the existing debounced note-text save
//     (useNoteSaveQueue.ts's queueSave -> flushSave -> saveNote{cursorPos}).
//  2. Closing a section (App.tsx's handleCloseSection) flushes that
//     section's position via persistActiveNoteEditModeStateNow() before its
//     editor unmounts, rather than depending on the ~350ms debounce timer
//     to survive the unmount on its own.
//
//   node scripts/perf/verifyCM6CursorPersistenceCheckpoints.mjs
import { chromium } from 'playwright';
import path from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { startDevServer, waitForAppReady, ensureEditMode } from './perfHarness.mjs';

const PORT = 5189;

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

  // --- Check 1: typing alone piggybacks cursorPos onto the debounced save,
  // with no explicit saveNoteUiState call in between. ---
  const noteId = await page.evaluate(async () => {
    const note = await window.thockdownNotes.createNote({ initialText: 'Hello world' });
    await window.thockdownSections.setActiveNote('default', note.id);
    return note.id;
  });
  await page.reload();
  await ensureEditMode(page);
  await page.waitForTimeout(400);

  const line = page.locator('.cm-line').first();
  await line.click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('End');
  await page.keyboard.type('!!!');

  // SAVE_DEBOUNCE_MS is 350ms; give the debounced write plenty of margin.
  await page.waitForTimeout(900);

  const uiStateAfterTyping = await page.evaluate(async (id) => (
    window.thockdownNotes.getNoteUiState({ id })
  ), noteId);
  console.log('  note UI state after typing alone:', JSON.stringify(uiStateAfterTyping));
  assertEqual(uiStateAfterTyping.cursorPos, 'Hello world!!!'.length, 'cursorPos piggybacked from typing alone, no explicit saveNoteUiState');

  // --- Check 2: closing a section flushes its cursor position immediately,
  // ahead of the debounce timer that a just-typed keystroke started. Set up
  // a second section (via the same setActiveNote + reload pattern the rest
  // of this suite uses), type into it, then close it well inside the
  // 350ms debounce window. ---
  const { noteId2, sectionId2 } = await page.evaluate(async () => {
    const note = await window.thockdownNotes.createNote({ initialText: 'Second note for close-checkpoint test' });
    const updated = await window.thockdownSections.createSection(null, 0);
    const created = updated.find((entry) => entry.position === 1);
    await window.thockdownSections.setActiveNote(created.id, note.id);
    return { noteId2: note.id, sectionId2: created.id };
  });
  await page.reload();
  await ensureEditMode(page);
  await page.waitForTimeout(400);

  const slots = page.locator('.editor-section-slot');
  assertEqual(await slots.count(), 2, 'two section slots rendered after creating a second section');

  const secondSlot = slots.nth(1);
  const secondLine = secondSlot.locator('.cm-line').first();
  await secondLine.click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('End');
  await page.keyboard.type('XYZ');

  // Close the section immediately -- well inside the 350ms debounce window,
  // so only the explicit persistActiveNoteEditModeStateNow() checkpoint
  // (not the debounce timer) can be responsible for any persisted position.
  await secondSlot.locator('.section-close-toggle').click();
  await page.waitForTimeout(200);

  const uiStateAfterClose = await page.evaluate(async (id) => (
    window.thockdownNotes.getNoteUiState({ id })
  ), noteId2);
  console.log('  note UI state immediately after closing its section:', JSON.stringify(uiStateAfterClose));
  assertEqual(uiStateAfterClose.cursorPos, 'Second note for close-checkpoint test'.length + 3, 'cursorPos flushed by the close-section checkpoint, ahead of the debounce timer');

  const remainingSlots = await page.locator('.editor-section-slot').count();
  assertEqual(remainingSlots, 1, 'closed section slot removed from the DOM');
  void sectionId2;

  assertEqual(consoleErrors.length, 0, `no console errors (saw: ${JSON.stringify(consoleErrors)})`);

  console.log('\n[verify] ALL CHECKS PASSED');
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
