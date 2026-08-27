/*
 * Black-edit-pane bisection (parked investigation -- see the "Editor renders
 * black at small border radii" section of docs/cm6-parity-hardening-plan.md).
 *
 * The defect only reproduces on a real GPU-composited Electron build; every
 * instrument available to a Claude Code session (dev:browser under Playwright,
 * standalone CSS probes, SwiftShader) renders it correctly, so the only way to
 * localize it is to toggle candidates in the running app and look.
 *
 * HOW TO USE
 *   1. In the app: Options > Debugging > the </> button (opens DevTools).
 *   2. Paste this whole file into the console, once.
 *   3. Reproduce the black pane (border radius 1px, edit mode).
 *   4. Call t(1), t(2), ... and note which number clears it. t(0) restores.
 *
 * Cases 1-3 confirm which pairing causes it. Cases 4-8 are candidate FIXES
 * that keep both the edge fade and the rounded corners -- if one of those
 * clears it, that is the shipping change. The rest narrow down which layer is
 * actually painting black.
 */
(() => {
  const CASES = [
    ['baseline (nothing changed)', ''],
    ['fade mask OFF (.edit-container)', '.edit-container{-webkit-mask-image:none!important;mask-image:none!important}'],
    ['stage radius 0', '.editor-stage{border-radius:0!important}'],
    ['stage overflow visible', '.editor-stage{overflow:visible!important}'],
    ['edit-container own layer (will-change)', '.edit-container{will-change:transform}'],
    ['edit-container contain:paint', '.edit-container{contain:paint}'],
    ['edit-container translateZ(0)', '.edit-container{transform:translateZ(0)}'],
    ['CM6 scroller not scrollable', '.cm-scroller{overflow:hidden!important}'],
    ['CM6 scroller own layer', '.cm-scroller{will-change:transform}'],
    ['editor texture hidden', '.markdown-editor-texture{display:none!important}'],
    ['render-container removed', '.render-container{display:none!important}'],
    ['render-container mask off', '.render-container{-webkit-mask-image:none!important;mask-image:none!important}'],
    ['grid overlays hidden', '.thockdown-grid-lines,.thockdown-grid-outline-lines{display:none!important}'],
    ['block caret hidden', '.thockdown-block-caret{display:none!important}'],
    ['stage isolation:isolate', '.editor-stage{isolation:isolate}'],
    ['stage own layer (will-change)', '.editor-stage{will-change:transform}'],
  ];
  let el = document.getElementById('__tdbisect');
  if (!el) { el = document.createElement('style'); el.id = '__tdbisect'; document.head.appendChild(el); }
  window.t = (n) => {
    const c = CASES[n];
    if (!c) { console.log('no such case'); return; }
    el.textContent = c[1];
    console.log(`[${n}] ${c[0]}`);
    return c[0];
  };
  window.tList = () => CASES.forEach((c, i) => console.log(`t(${i}) — ${c[0]}`));
  // What the app currently thinks it is, so the report is self-contained.
  const shell = document.querySelector('.app-shell');
  const stage = document.querySelector('.editor-stage');
  console.log('radius:', shell && getComputedStyle(shell).getPropertyValue('--border-radius-regular').trim(),
              '| stage radius:', stage && getComputedStyle(stage).borderRadius,
              '| preview mode:', stage && stage.className.includes('is-preview-mode'));
  console.log('elements found:', CASES.slice(1).map((c, i) => {
    const sel = c[1].split('{')[0];
    return `${i + 1}:${document.querySelectorAll(sel).length}`;
  }).join(' '));
  window.tList();
  console.log('Call t(1), t(2), ... and note which one clears the black. t(0) restores.');
})();
