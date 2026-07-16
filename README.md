# Thockdown Notes

Desktop-first notes application built with Electron, React, Lexical, and Vite.

## Development

1. Install dependencies:

```bash
npm install
```

2. Run the standard desktop development flow (Vite + Electron):

```bash
npm run dev
```

3. Run browser-only mode for shared-page automation and deterministic renderer testing:

```bash
npm run dev:browser
```

Browser-only mode disables the Electron plugin chain and installs dev-only mock bridges via
`src/dev/installBrowserMockBridges.ts` so `window.thockdownNotes` and `window.thockdownState` are available.

## Tests

```bash
npm run test
```

## Project Docs

- [Interaction Design Philosophy](docs/interaction-design-philosophy.md)
- [V2 Editor Contract](docs/V2_EDITOR_CONTRACT.md)
- [V2 Session Handbook](docs/V2_SESSION_HANDBOOK.md)
