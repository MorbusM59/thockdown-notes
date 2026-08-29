# Release protocol

One command cuts a release:

```bash
npm run release
```

That's a patch bump. `npm run release -- minor`, `-- major`, or `-- 0.7.2` for
anything else. Add `--dry-run` to watch the whole thing happen without touching
git, GitHub, or the build.

Everything below is what that command does and why it does it that way. You
shouldn't need to run any of it by hand.

## The shape of the problem

Thockdown Notes ships for Windows and macOS. A Windows machine cannot build a
DMG — Apple's disk-image tooling only exists on macOS. So a release has two
halves that have to meet:

- **Windows** builds on the maintainer's machine (`npm run build` → an NSIS
  installer and a portable `.zip`).
- **macOS** builds on a GitHub Actions mac runner
  (`.github/workflows/build-mac.yml`), triggered by pushing the version tag.

They meet at the GitHub release. `scripts/release.mjs` drives the local half,
waits for the cloud half, and verifies both landed intact.

## What the command actually does

1. **Preflight.** Refuses to go on unless you're on `main`, the tree is clean,
   local and `origin/main` are the same commit, and `gh` is authenticated. Every
   later step assumes these; failing here costs nothing, failing later costs a
   tag.
2. **Version.** Computes the next version and the tag name. If the tag already
   exists it says so and skips ahead — see *Resuming*, below.
3. **Release notes.** Writes `release-notes/vX.Y.Z.md`, pre-filled with every
   commit subject since the previous tag, then **pauses** so you can edit it.
   This is the one place a human is required. What's in that file becomes the
   GitHub release body verbatim (HTML comments are stripped). The generated
   commit list is a *starting point*, not the deliverable — put two or three
   sentences at the top saying what changed for someone using the app, and
   delete or group the commits that only matter to the repo.
4. **Test gate.** Runs `npm test`. A failing suite stops the release *before*
   the tag is pushed, which is the last moment stopping is free. `--skip-tests`
   opts out; CI still runs the suite on the mac side.
5. **Bump, tag, push.** Writes the version into `package.json` *and*
   `package-lock.json`, commits `Release vX.Y.Z`, tags it, pushes both. Pushing
   the tag is what starts the macOS build.
6. **Create the prerelease.** Creates the GitHub release as a **prerelease**,
   with your notes, titled `Alpha Release #N` — N read off the highest existing
   one, so nobody has to count.
7. **Windows build.** `npm run build`, then finds the `.exe` and `.zip` in
   `release/<version>/`.
8. **Wait for macOS.** Watches the `build-mac` run for this tag and reports how
   it ended. If it failed, the release still ships with the Windows builds and
   you're told the DMG is missing.
9. **Upload and verify.** Uploads the Windows artifacts, checks every asset's
   checksum (see below), and publishes `SHA256SUMS.txt`.

Then you open the release, read it once, and add a screenshot if it deserves
one. It stays a prerelease until you promote it yourself.

## What "verified" means here

Not code signing. The app is unsigned on both platforms — that needs an Apple
Developer certificate ($99/yr) and a Windows code-signing certificate, and
neither exists yet. macOS users will still see a Gatekeeper warning.

What is verified is **integrity**: that the bytes on the release page are the
bytes that were built.

- The Windows artifacts are hashed on this machine after the build.
- The DMG is hashed on the mac runner, which uploads a small `.sha256` sidecar
  alongside it.
- GitHub independently hashes every asset it receives and reports it via the
  API as `digest`.
- The script compares build-side hash against GitHub-side hash for every asset
  and **aborts if any pair disagrees**. The DMG is checked this way too, without
  downloading 200+ MB back — the sidecar stands in for the local hash.
- The agreed hashes are published as `SHA256SUMS.txt`, so a user can verify
  their own download:

  ```bash
  sha256sum -c SHA256SUMS.txt
  ```

  (`shasum -a 256 -c` on macOS; `Get-FileHash` on Windows PowerShell.)

Adding real signing later changes only the build step and this section — the
rest of the protocol is unaffected.

## Resuming

Releases fail partway: the network drops, a mac runner dies, a build breaks.
The fix is always the same: **run the same command again.** An existing tag
isn't re-tagged, an existing release isn't re-created (its notes are refreshed
from the file), an existing build isn't rebuilt, uploads clobber rather than
duplicate, and a missing or failed mac build is re-dispatched. Nothing needs to
be undone first.

The subtle part is *which version* a re-run means. By the time anything can
fail, the new version is already written into `package.json` — so a plain bump
would step over the unfinished release and cut a second one. Instead, if the
current version is tagged and its release is missing any of its three
deliverables (a `.dmg`, an `.exe`, and `SHA256SUMS.txt`), the script says so and
resumes that version. `--force-new` bumps anyway.

To redo the notes for a release that already exists, edit
`release-notes/vX.Y.Z.md` and re-run — step 6 pushes the file's contents back up.

## Before you release

Not enforced by the script, because judgment can't be:

- **Did a user-facing change ship?** Then `electron/help/helpGuideContent.ts`
  needs to describe it. That file is the canonical user documentation
  (see `CLAUDE.md`), and a release is the deadline for it being true.
- **Does `TODO.md` still describe reality?** Things fixed in this batch should
  be checked off.
- **Does the version match the change?** Patch for fixes, minor for features
  a user would notice.

## History

- **v0.5.8** — first release under this protocol, and the first with a macOS
  build attached. Three separate faults had to be cleared to get one DMG onto a
  release page, all of which failed *after* a successful build:
  - `build-mac.yml` never requested `contents: write`, so the job's token was
    read-only by repo default and the upload failed with `Resource not
    accessible by integration`. This is why no release before v0.5.8 had a DMG:
    v0.5.7's was built and thrown away, and so, silently, were the ones before.
  - electron-builder saw a tag in the CI environment, decided by itself that
    artifacts "will be published", and aborted demanding `GH_TOKEN` — with the
    DMG already on disk. Fixed with `--publish never`: uploading is the
    workflow's job, not the builder's.
  - The checksum step matched nothing, because GitHub rewrites spaces in asset
    filenames to dots and the local map was keyed on the on-disk name. It
    degraded to warnings rather than failing, which is its own small lesson —
    a verification step that can't match should be loud.

  Two more, found by cutting the release itself:
  - A re-run after the stalled build bumped *past* the unfinished version
    instead of resuming it, cutting a v0.5.9 alongside the v0.5.8 it was
    supposed to finish. v0.5.8 was deleted as a false start; the resume rule
    above is the fix.
  - The DMG checksum sidecar is `<hash>  Thockdown Notes-Mac-….dmg` — and the
    filename has a space in it. Splitting on all whitespace truncated the name
    to "Thockdown", so the DMG silently went unverified. Split on the first run
    of whitespace only.

  The `workflow_dispatch` `tag` input dates from the same session: a tag freezes
  its own workflow file, so a pipeline fixed *after* tagging can never re-run
  against its tag. Dispatching from `main` with `tag=vX.Y.Z` runs the current
  workflow against the tagged source, which is what makes a broken release
  recoverable without moving or burning a tag.
