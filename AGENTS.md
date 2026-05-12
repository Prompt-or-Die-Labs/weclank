# AGENTS.md

Essential guidance for working in the Weclank repository.

## Commands
- `bun dev` — development with file watching
- `bun start` — one-shot run  
- `bun check` — **MUST** be clean before any commit (typecheck + lint + tests)
- `bun test` — run test suite
- `bun lint` — Biome lint (no formatter)
- `bun build:canary` — production build

## Critical Setup
- **ffmpeg must be on PATH** for RTMP egress (install via `brew install ffmpeg` or equivalent)
- Bun ≥ 1.3 required
- Inter and JetBrains Mono fonts recommended (UI falls back to system stacks)

## Architecture Highlights
- **Two-process design**: Bun main (SQLite, ffmpeg, file dialogs) + webview renderer (UI, agents, mixers)
- Communication via typed RPC (`src/bun/index.ts` defines schema, `src/mainview/rpc.ts` consumes it)
- **Persistence**: SQLite stores accounts, scenes, agent state. Path varies by OS:
  - macOS: `~/Library/Application Support/Weclank/studio.db`
  - Linux: `~/.config/weclank/studio.db`  
  - Windows: `%APPDATA%\Weclank\studio.db`
- **AudioContext gesture lock**: Must resume after user interaction (providers call `audioMixer.resume()` in `speak()`)
- **Blob URLs** for VRM/GLB models don't survive reload (cleared by persistence, user must re-attach via Edit → Replace model)

## Testing Notes
- Tests are co-located (`*.test.ts` files)
- DOM-dependent modules (`stream-overlays`, `tool-executor`, `transcript/feed`) are skipped in test suite
- Green bar (`bun check`) requires typecheck **AND** lint **AND** tests to pass

## Key Gotchas
- macOS mic permission requires BOTH entitlement (`com.apple.security.device.audio-input`) AND runtime grant
- Grid layout: `AppHeader`, `ScenePanel`, `ToolRail` use `grid-area` on root classes — adding wrapper divs breaks layout
- Tool-calling: `openrouter/free` model filters to tool-capable LLMs; swapping to non-tool model degrades to speak-only
- Music persistence: Remote Suno URLs re-fetch after first user gesture; blob URLs don't survive reload
- `Uint8Array` generics: `getByteFrequencyData` needs concrete `Uint8Array<ArrayBuffer>`, not `ArrayBufferLike`

## Adding Features
See `CLAUDE.md` for detailed recipes:
- New TTS provider: Extend base provider, register in `tts/registry.ts`, add to secrets cache
- New agent tool: Add to `BANTER_TOOLS`, extend `ToolInvocation` union, implement in `tool-executor.ts`
- New SourceKind: Add to union, build renderer, register in `renderers/index.ts`, handle in `source-factory.ts`
- New auth-protected RPC: Extend `PhotoBoothRPC` in `src/bun/index.ts`, implement handler, call via `bunRpc`

## Secrets Storage
API keys + RTMP credentials stored plaintext in SQLite `user_secrets` table. Not encrypted at rest (threat model matches shell history; full-disk encryption recommended).