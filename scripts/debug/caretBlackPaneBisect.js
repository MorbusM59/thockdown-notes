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
 * Cases 1-3 confirm which pairing causes it. Cases 4-8 (and 14-15) are
 * candidate FIXES that keep both the edge fade and the rounded corners -- if
 * one of those clears it, that is the shipping change. Cases 16-17 narrow what
 * about the mask matters: whether any mask triggers it or only the gradient,
 * and whether a plain clip is clean. The rest narrow down which layer is
 * actually painting black.
 *
 * NOTE: the block caret (case 13) is already RULED OUT -- it is fully
 * de-promoted now and the black persists regardless. It is kept only so a run
 * can confirm that independently.
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
    // Splits "any mask does it" from "the GRADIENT does it" -- a solid mask is
    // still a mask (same render surface, same compositing path) but has no
    // gradient to rasterize. Different answers point at different fixes.
    ['fade mask replaced with a SOLID mask', '.edit-container{-webkit-mask-image:linear-gradient(#000,#000)!important;mask-image:linear-gradient(#000,#000)!important}'],
    // A hard cut in place of the fade: same clipping effect, no mask at all.
    // If this is clean, the fade can be kept as a shape and only its softness
    // is at issue.
    ['fade replaced with clip-path (no mask)', '.edit-container{-webkit-mask-image:none!important;mask-image:none!important;clip-path:inset(3px 0)}'],
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
