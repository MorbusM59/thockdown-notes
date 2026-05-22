# V2 Phase 2 Validation Matrix

Use this matrix to close Phase 2 gate criteria with explicit evidence.

## Scope
- Deterministic fixed-focus behavior.
- Stable line-break and boundary mechanics.
- Consistent caret/selection behavior under stress.
- No flicker/jump caused by browser/editor lifecycle conflicts.

## Environment
- OS: Windows
- Build: `npm run dev`
- Branch: `v2-rewrite`
- Date: 2026-05-22
- Tester: Copilot (automated browser checks)

## Pass Criteria
- All required scenarios are marked PASS.
- No unresolved HIGH severity anomalies.
- Any MEDIUM/LOW anomalies have documented mitigation and owner.

## Scenario Table

| ID | Scenario | Steps | Expected | Result | Notes |
| --- | --- | --- | --- | --- | --- |
| P2-01 | Enter near top boundary | Place caret within 1 row of top cage boundary. Press Enter repeatedly. | Caret/text remain in sync; row-step movement deterministic; no jitter. | PASS (MANUAL) | User-validated: no jitter observed in live interaction after caret/scroll sequencing fix. |
| P2-02 | Enter near bottom boundary | Place caret within 1 row of bottom cage boundary. Press Enter repeatedly. | Deterministic movement; no skipped/phantom rows; no desync. | PASS (MANUAL) | User-validated: movement correct and previous transient bounce no longer observed. |
| P2-03 | Rapid key repeat | Hold key repeat for character input and ArrowUp/ArrowDown. | No caret/text desync, no visual flicker/jump. | MANUAL PENDING | Needs sustained human observation. |
| P2-04 | Undo/redo consistency | Perform mixed edits, line breaks, and navigation. Use undo/redo cycles. | Caret and viewport remain consistent and deterministic. | PASS (AUTO) | Script: `line1` + Enter + `line2`, undo -> `line1`, redo -> `line1line2`, caret offsets stable. |
| P2-05 | Wheel scroll authority | Scroll with wheel in both directions at varying speeds. | One authority path, row-quantized behavior, no smooth drift. | PARTIAL (AUTO) | Observed `scrollTop % 24 == 0`; full authority/perception still needs manual check. |
| P2-06 | Paste with trailing newlines | Paste text ending with CRLF+CRLF and with LF-only tails. | Visual caret reflects actual selection; first typed key inserts where caret appears. | PASS (AUTO) | With `alpha\r\n\r\n`, post-paste lines: `["alpha", "", ""]`, caret line index `2`; first typed char produced `["alpha", "", "X"]`. |
| P2-07 | Boundary navigation after paste | From end of pasted text, ArrowUp/ArrowDown across wrapped and empty lines. | No line skip, no sticky end behavior, no mismatch after movement. | PASS (AUTO) | After paste-tail case, ArrowUp/ArrowDown moved selection line index deterministically between adjacent lines. |
| P2-08 | Resize during editing | Resize window while editing near both boundaries. | Separator, cage, and caret remain aligned; no boundary drift. | PARTIAL (AUTO) | Structural check passed: boundary handles remained row-quantized (`mod 24 = 0`) through multiple viewport resizes; perceptual alignment still manual. |
| P2-09 | Drag boundary handles | Drag top and bottom handles across multiple positions. | Visual separator and internal cage stay synchronized to row grid. | PARTIAL (AUTO) | Programmatic drag (~53px) snapped to row grid (`bottom: 132 -> 180`, quantized); perceptual sync still manual. |
| P2-10 | Long document traversal | Navigate and edit through large multi-paragraph content. | Stable behavior over time; no cumulative drift. | MANUAL PENDING | Needs prolonged exploratory run. |

## Defect Logging
- Severity levels: HIGH, MEDIUM, LOW.
- Record each failure with:
  - Scenario ID
  - Repro steps
  - Observed behavior
  - Expected behavior
  - Suspected component
  - Status/owner

## Gate Decision
- Phase 2 status: `OPEN` / `READY TO CLOSE`
- Decision notes: OPEN. Top/bottom Enter boundary scenarios are now manually validated PASS. Remaining closure risk is rapid-repeat/flicker perception and prolonged traversal checks.
