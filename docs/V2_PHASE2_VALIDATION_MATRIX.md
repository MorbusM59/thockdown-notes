# V2 Phase 2 Validation Matrix

Use this matrix to close Phase 2 gate criteria with explicit evidence.

## Scope
- Deterministic fixed-focus behavior.
- Stable line-break and boundary mechanics.
- Consistent caret/selection behavior under stress.
- No flicker/jump caused by browser/editor lifecycle conflicts.

## Environment
- OS:
- Build: `npm run dev`
- Branch:
- Date:
- Tester:

## Pass Criteria
- All required scenarios are marked PASS.
- No unresolved HIGH severity anomalies.
- Any MEDIUM/LOW anomalies have documented mitigation and owner.

## Scenario Table

| ID | Scenario | Steps | Expected | Result | Notes |
| --- | --- | --- | --- | --- | --- |
| P2-01 | Enter near top boundary | Place caret within 1 row of top cage boundary. Press Enter repeatedly. | Caret/text remain in sync; row-step movement deterministic; no jitter. | TODO |  |
| P2-02 | Enter near bottom boundary | Place caret within 1 row of bottom cage boundary. Press Enter repeatedly. | Deterministic movement; no skipped/phantom rows; no desync. | TODO |  |
| P2-03 | Rapid key repeat | Hold key repeat for character input and ArrowUp/ArrowDown. | No caret/text desync, no visual flicker/jump. | TODO |  |
| P2-04 | Undo/redo consistency | Perform mixed edits, line breaks, and navigation. Use undo/redo cycles. | Caret and viewport remain consistent and deterministic. | TODO |  |
| P2-05 | Wheel scroll authority | Scroll with wheel in both directions at varying speeds. | One authority path, row-quantized behavior, no smooth drift. | TODO |  |
| P2-06 | Paste with trailing newlines | Paste text ending with CRLF+CRLF and with LF-only tails. | Visual caret reflects actual selection; first typed key inserts where caret appears. | TODO |  |
| P2-07 | Boundary navigation after paste | From end of pasted text, ArrowUp/ArrowDown across wrapped and empty lines. | No line skip, no sticky end behavior, no mismatch after movement. | TODO |  |
| P2-08 | Resize during editing | Resize window while editing near both boundaries. | Separator, cage, and caret remain aligned; no boundary drift. | TODO |  |
| P2-09 | Drag boundary handles | Drag top and bottom handles across multiple positions. | Visual separator and internal cage stay synchronized to row grid. | TODO |  |
| P2-10 | Long document traversal | Navigate and edit through large multi-paragraph content. | Stable behavior over time; no cumulative drift. | TODO |  |

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
- Decision notes:
