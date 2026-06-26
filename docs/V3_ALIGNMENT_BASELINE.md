# V3 Alignment Baseline

## Purpose
This document captures the initial Phase 3 alignment baseline before implementing any visual-alignment refactors.

## Environment
- Date: 2026-05-23
- OS: Windows
- Build: `npm run dev`
- Branch: `v2-rewrite`
- Tester: Copilot (automated browser instrumentation)

## Baseline Style Metrics
- Font family: `"Syne Mono", monospace`
- Font size: `16px`
- Line height: `24px`
- Cell width variable: `10px`
- Letter spacing: `1.2px`
- Text transform: `matrix(1, 0, 0, 1, 0.6, 0)`
- ContentEditable padding: left `40px`, top `144px`

## Font Metric Snapshot
Measured with canvas for current editor font:
- `0` width: `5.562px`
- `W` width: `9.438px`
- `i` width: `2.222px`

Interpretation:
- Glyph advances are intentionally normalized by CSS letter-spacing and transform rather than native monospace equality.
- No immediate font-load drift observed (see next section).

## Font-Ready Stability Check
- `document.fonts.status` before `fonts.ready`: `loaded`
- `document.fonts.status` after `fonts.ready`: `loaded`
- Width drift after readiness wait:
  - `0`: `0.0000px`
  - `W`: `0.0000px`
  - `i`: `0.0000px`

Interpretation:
- In this runtime session, font metrics were already stable at measurement time.

## Caret/Grid Snap Baseline
Probe points included: non-empty rows, wrapped line end, empty rows, terminal empty row.

Observed maxima:
- Max top snap error vs 24px line lattice: `2.0px`
- Max left snap error vs 10px cell lattice: `0.4px`
- Fallback geometry samples: 8/8 points (adjacent-probe or anchor-fallback)

Interpretation:
- Horizontal alignment is close to the intended cell lattice.
- Vertical alignment shows a consistent `~2px` offset from exact row lattice in this measurement path.
- Caret geometry in collapsed states currently depends heavily on fallback geometry sources.

## Phase 3 Decision: Offset Classification
Additional rendered-caret probe (same scenario set) measured `.measly-block-caret` directly:
- `top` snapped exactly to 24px lattice at all sampled points.
- `left` snapped exactly to 10px lattice at all sampled points.
- Rendered caret size remained `10x24` as expected.

Decision:
- The observed `~2px` offset is classified as a raw selection-rect measurement artifact, not a rendered caret/grid misalignment defect.
- No corrective alignment patch is warranted for this signal alone.

Constraint for future work:
- Alignment decisions should use rendered-caret lattice metrics as primary truth.
- Raw DOM range rects remain diagnostic only in fallback geometry analysis.

## Structural Notes
- Paragraph count in probe fixture: `10`
- Scroller snapshot during probe:
  - client size: `1207x504`
  - scroll height: `552`

## Known Measurement Limits
- The shared browser surface does not expose true Electron app-window resize semantics; viewport resize calls did not produce distinct window-state baselines.
- Therefore this baseline is valid for current runtime/style state, but not yet a full resize matrix.

## Manual Resize Confirmation
- Date: 2026-05-23
- Source: User live app validation
- Outcome: "resizing feels clean"

Interpretation:
- No perceptual drift or jitter was observed during manual resize in the actual app window.
- This closes the environment gap noted above for practical Phase 3 progression, while preserving the numeric baseline for regression checks.

## Provisional Phase 3 Acceptance Thresholds
These thresholds are set to enable deterministic pass/fail checks for upcoming alignment work.

- Vertical row snap error (`topSnapError`):
  - Target: <= `2.0px`
  - Fail threshold: > `3.0px`

- Horizontal cell snap error (`leftSnapError`):
  - Target: <= `0.5px`
  - Fail threshold: > `1.0px`

- Caret geometry source usage:
  - Collapsed empty-line states may use fallback rect sources.
  - Non-empty text states should not regress from current behavior (primary/client-rect coverage must not decrease in scenarios where it currently exists).

- Resize stability (manual gate):
  - No visible jump/flicker/drift during slow and fast window resize sweeps.

## Additional Probe Outcomes (2026-05-23)

### Glyph Advance vs Cell Width
Probe set: `0000000000`, `WWWWWWWWWW`, `iiiiiiiiii`, `abcdefghij`, `ABCDEFGHIJ`, `0123456789`, `mixMiX09wW`

Result:
- Measured width for each 10-character row: `100px`
- Effective average advance: `10px`
- Delta from cell width (`10px`): `0px` across all samples

Interpretation:
- Glyph advance alignment to cell width is currently exact in sampled content.

### Baseline/Row Stability Across Mixed Content
Probe set included:
- Non-empty short rows
- Empty rows
- Wrapped long row (`height: 48px`)

Result:
- All paragraph tops snapped exactly to 24px row lattice (`topSnapError = 0`).
- Non-wrapped rows: `height = 24px` and step-to-next `24px`.
- Wrapped row: `height = 48px` and step-to-next `48px` (exact multiple of line height).

Interpretation:
- Row/baseline lattice behavior is stable across mixed content, including wraps and empty lines.

## Manual Selection Perception Gate (2026-05-24)
User-run manual suite outcome: `PASS all 3`

Scenarios passed:
- Downward drag selection across bottom boundary with sustained auto-scroll.
- Upward drag selection across top boundary with sustained auto-scroll.
- Mixed-content drag across short, wrapped, and empty-line regions.

Interpretation:
- Selection highlight perception remained aligned during drag-extension and boundary auto-scroll.
- No post-selection corrective snap was required for acceptable visual alignment.

## Startup + Font-Ready + Initial Render Check (2026-05-24)
Probe result:
- `document.fonts.status` before/after ready: `loaded` -> `loaded`
- Initial scroll position: `0`
- First paragraph top in scroller: `144px` (24px lattice aligned)

Interpretation:
- Initial render and font-ready state are aligned with the row lattice in current runtime conditions.
- Combined with manual resize confirmation, this closes the Phase 3 resize/font-ready/initial-render criterion.

## Phase 3 Immediate Next Actions
1. Verify whether the consistent `~2px` vertical offset is intentional (font baseline policy) or drift.
2. Use the provisional thresholds above to evaluate each alignment change before merge.
3. Build a compact regression probe pack for non-empty/wrapped/empty/terminal caret states.
