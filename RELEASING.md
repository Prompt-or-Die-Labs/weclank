# Releasing Weclank

## Fully automated pipeline

1. **Merge to `main`** (or push directly to `main`).
2. **`.github/workflows/auto-release-tag.yml`** runs (queued per branch so tag jobs do not race). It:
   - Fetches existing `v*` tags from `origin`.
   - Skips if `HEAD` is already exactly the latest tag, or if the tip commit message contains **`[skip release]`**.
   - Otherwise computes the next **semver** from the **highest** existing `v*` tag and commit subjects since that tag:
     - **`feat:` / `feat(scope):`** → **minor** bump (resets patch to `0`).
     - **`type!:`** (e.g. `feat!:`) or **`BREAKING CHANGE`** in the subject → **major** bump.
     - Otherwise → **patch** bump.
   - If there has never been a tag, the first tag is **`v` + `version` from `package.json`** (then collision-avoidance bumps patch if that tag already exists on the remote).
   - Creates an **annotated** tag and **`git push origin <tag>`**, which triggers the release workflow.
3. **`.github/workflows/release.yml`** (on **`push` of tags `v*`**):
   - **Verify** — `bun run check` on Ubuntu.
   - **Build** — macOS (arm64), Linux (x64), Windows (x64): sync version from tag, `bun run build:canary`, archive `build/canary-*` to `weclank-<tag>-<platform>.tar.gz`.
   - **Publish** — GitHub Release + uploaded artifacts + generated release notes.

### Skip a release for one merge

Put **`[skip release]`** in the **tip** commit message of the push to `main` (e.g. squash-merge description). The auto-tag job will not run for that push.

### Manual tag or bump override

- You can still **`git tag vX.Y.Z && git push origin vX.Y.Z`** by hand; the same release workflow runs.
- **Actions → Auto-tag release → Run workflow** with **bump** set to `patch` / `minor` / `major` to **force** that bump for the next tag (ignores conventional inference for that run only). Leave **auto** to infer from commits.

### Optional env override (advanced)

The script reads **`BUMP=major|minor|patch`** if set in the job environment (e.g. a repository variable wired into the workflow).

### Install from a release archive

Each `.tar.gz` contains one `canary-*` directory produced by Electrobun (e.g. `.app` on macOS, platform layout on Linux/Windows). Extract with:

```bash
tar -xzf weclank-v0.2.0-macos-arm64.tar.gz
```

Then open/run the app bundle or binary as documented for Electrobun on that OS.

## Code signing and notarization (macOS)

The repo ships with `codesign: false` in `electrobun.config.ts`. CI builds are **unsigned**. For Gatekeeper-friendly macOS distribution you will need Apple Developer ID credentials, entitlements, and notarization wired into Electrobun and CI secrets — see the Electrobun distribution docs and `electrobun.config.ts` `build.mac` options when you are ready.

## Version source of truth

- **The pushed tag** is what release builds use: `sync-release-version.ts` sets `package.json` and `electrobun.config.ts` `app.version` on the runner from that tag.
- **`package.json` `version`** is still the baseline for the **first** tag when no `v*` tags exist yet; after that, tags advance independently until you optionally bump `package.json` on `main` for human-readable “next line” alignment.
