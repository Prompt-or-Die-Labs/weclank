# Project Learnings

> Managed by `/learn`. Append-only — latest entry wins on conflicts.

## Patterns

### source-kind-extension-path
- **Insight:** Add a new source kind by updating `SourceKind`, `createParticipantFromKind`, `createRenderer`, and the StageToolbar add-source menu; text assistants are the special non-canvas case.
- **Confidence:** 9/10
- **Source:** learn
- **Files:** src/mainview/core/types.ts, src/mainview/state/source-factory.ts, src/mainview/renderers/index.ts, src/mainview/components/stage-toolbar.ts
- **Date:** 2026-05-12

### broadcast-composition-canvas
- **Insight:** The broadcast path is a single StreamEngine canvas that draws active-scene renderer frames by normalized placement, then draws the overlay plane, then captures the canvas with mixed audio.
- **Confidence:** 9/10
- **Source:** learn
- **Files:** src/mainview/streaming/stream-engine.ts, src/mainview/state/studio-store.ts
- **Date:** 2026-05-12

## Pitfalls

### docs-post-rename-stale
- **Insight:** Some docs still mention Studio Live or StudioLive and `components/stage-controls.ts`; verify live names and paths with `rg` before following repo recipes.
- **Confidence:** 9/10
- **Source:** learn
- **Files:** DESIGN.md, CLAUDE.md, src/mainview/components/stage-toolbar.ts
- **Date:** 2026-05-12

### persisted-state-drops-runtime
- **Insight:** Persisted studio state intentionally strips live MediaStreams, live/recording flags, transient overlays, and blob-backed visual assets, so restore code must reacquire runtime resources.
- **Confidence:** 9/10
- **Source:** learn
- **Files:** src/mainview/state/persistence.ts, src/mainview/state/studio-store.ts
- **Date:** 2026-05-12

## Preferences

## Architecture

### typed-rpc-process-boundary
- **Insight:** Weclank splits Bun main-process work from renderer work through the `PhotoBoothRPC` schema in `src/bun/index.ts` and the renderer-side `bunRpc` entrypoint in `src/mainview/rpc.ts`.
- **Confidence:** 9/10
- **Source:** learn
- **Files:** src/bun/index.ts, src/mainview/rpc.ts
- **Date:** 2026-05-12

### studio-store-lifecycle-owner
- **Insight:** `StudioStore` owns scene and participant mutations while `source-factory` registers cleanup callbacks for runtime resources such as TTS routes, media tracks, mixer inputs, banter sessions, and blob URLs.
- **Confidence:** 9/10
- **Source:** learn
- **Files:** src/mainview/state/studio-store.ts, src/mainview/state/source-factory.ts
- **Date:** 2026-05-12

## Tools

### weclank-green-bar
- **Insight:** Use `bun check` as the final validation gate because the package script runs TypeScript, Biome, and the Bun test suite together.
- **Confidence:** 10/10
- **Source:** learn
- **Files:** package.json
- **Date:** 2026-05-12
