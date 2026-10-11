# Security policy

This repository holds two apps: **Thockdown Notes** (desktop, Electron) and **Thockdown Soundscapes** (Android). Both are developed by one person.

## Reporting a vulnerability

Please report security problems privately, not in a public issue: use **Report a vulnerability** on this repository's [Security tab](https://github.com/MorbusM59/thockdown-notes/security/advisories/new). Include the app and version, what an attacker could do, and steps to reproduce.

You can expect an acknowledgement within a week. Fixes ship in the next release of the affected app, and the advisory is published once that release is out.

## Supported versions

Only the latest release of each app receives security fixes.

## Design notes for reporters

- The desktop app makes no network requests: it cancels any request a page attempts, refuses navigation away from its own document, and opens web links in the system browser (`apps/notes/electron/networkIsolation.ts`).
- Notes are stored locally and are never uploaded. The renderer reaches the main process only through declared channels (`apps/notes/src/shared/ipcContract.ts`).
