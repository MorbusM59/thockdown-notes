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
Every phase checks whether its work already exists before doing it, so the fix
is always the same: **run the same command again.** An existing tag isn't
re-tagged, an existing release isn't re-created (its notes are refreshed from
the file), an existing build isn't rebuilt, and uploads clobber rather than
duplicate. Nothing needs to be undone first.

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

- **v0.5.8** — first release under this protocol. It also fixed the reason no
  earlier release ever carried a macOS build: `build-mac.yml` never requested
  `contents: write`, so the job's token was read-only by repo default and the
  upload failed with `Resource not accessible by integration` *after* a
  successful build. v0.5.7's DMG was built and thrown away; so, silently, were
  the ones before it.
