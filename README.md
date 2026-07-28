# Thockdown Notes

Desktop notes app built with Electron, React, and Lexical.

Current version: **0.5.3**

Full usage documentation is built into the app itself — open the in-app Help note ($HELP). This file intentionally does not duplicate it.

## Install

Download a prebuilt release from the project's Releases page. Currently available:

- **Windows Installer** (`Thockdown Notes-Windows-<version>-Setup.exe`) — standard installer, installs per-user, data lives in `%APPDATA%`.
- **Windows Portable** (`Thockdown Notes-Windows-<version>-Portable.zip`) — unzip and run; all data, settings, and session state stay inside the extracted folder instead of `%APPDATA%`.

macOS and Linux prebuilt binaries are planned but not yet part of official releases (see Build from source below).

## Build from source

Prerequisites: [Node.js](https://nodejs.org/) (LTS) and npm.

```bash
npm install
```

Development:

```bash
npm run dev          # Vite + Electron
npm run dev:browser  # browser-only, with mock IPC bridges (window.thockdownNotes / window.thockdownState)
```

Tests:

```bash
npm run test
```

Production build (all platforms):

```bash
npm run build
```

This runs `tsc`, `vite build`, then `electron-builder` twice — once against `electron-builder.json5` (installer targets) and once against `electron-builder.portable.json5` (portable/zip targets). Output lands in `release/<version>/`.

### Windows
Run `npm run build` directly on Windows. Produces the NSIS installer (`...Setup.exe`) and the portable zip (`...Portable.zip`).

### macOS
Building a signed `.dmg` requires a macOS host (electron-builder's `mac` target does not cross-build from Windows/Linux). Either run `npm run build` on a Mac, or use the `Build macOS DMG` GitHub Actions workflow (`.github/workflows/build-mac.yml`), which builds on `macos-latest` and can be triggered manually (`workflow_dispatch`) or by pushing a `v*` tag.

### Linux
`npm run build` targets `AppImage` for both the installer and portable configs. This path is configured but not yet verified/released — expect rough edges.

## Releases directory layout

`electron-builder` writes to `release/<version>/`. Per-platform artifacts:

| Platform | Installer | Portable |
|---|---|---|
| Windows | `Thockdown Notes-Windows-<version>-Setup.exe` | `Thockdown Notes-Windows-<version>-Portable.zip` |
| macOS | `Thockdown Notes-Mac-<version>-Installer.dmg` | — |
| Linux | `Thockdown Notes-Linux-<version>.AppImage` | `Thockdown Notes-Linux-<version>-Portable.AppImage` |
