# V1 Ambiguous Decisions Queue

These items were resolved on 2026-05-19 and now act as implementation directives.

## Q1: Quantization Constants
Decision:
- Tunable.

Directive:
- Tune constants for stability and performance while preserving V1-feel behavior.

## Q2: External File Sanitization
Decision:
- Keep absolutely sanitized text.

Directive:
- External content must be normalized to plain text only.
- No links, graphics, existing styling/decoration artifacts, emojis, or non-standard characters.
- Output must be renderable via standard monofont glyphs in the app fonts.

## Q3: Timeline Distribution Parameters
Decision:
- Not strict identity, but current tuning felt exactly right.

Directive:
- Carry over current distribution shape and tuning unless a proven regression fix requires change.

## Q4: Main Process Dev URL Fallback
Decision:
- No fallback behavior needed in production.

Directive:
- Production runtime must not include dev URL fallback logic.

## Q5: Protected Tag Semantics
Decision:
- Open to an even more intuitive solution; current protected-temp functionality aligns well.

Directive:
- Preserve current semantics as baseline and explore an improved guided conversion UX later.
