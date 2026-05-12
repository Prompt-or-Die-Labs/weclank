# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Studio Live** — an open-source local-first streaming studio with AI co-hosts. Built on Electrobun (Bun main process + WKWebView/CEF renderer). One binary, no cloud. Source-available scenes, agents, tool calls, RTMP egress, and per-user data — all living in a SQLite file on the user's machine.

The product is a single app — splash → local login → studio. The studio composes scenes from camera/screen/mic/AI participants, fans the broadcast out to one or many RTMP destinations via ffmpeg (with hardware encoding auto-selected), and lets an LLM-driven banter agent drive overlays, music, and captions in response to chat, mic transcription, and a tail of the user's Claude Code / Codex coding session.

## Commands

- `bun start` — run the app (`electrobun dev`)
- `bun dev` — run with file watching
- `bun build` / `bun build:canary` — production build (`electrobun build --env=canary`). **Releases:** merging to `main` auto-creates the next `v*` tag and triggers `.github/workflows/release.yml` (artifacts + GitHub Release). See `RELEASING.md` (`[skip release]` to skip one merge).
- `bun test` — run the test suite
- `bun test:watch` — tests with rerun on save
- `bun check` — green-bar gate: typecheck **and** tests
- `bunx tsc --noEmit` — typecheck only

Electrobun's bundler handles transpilation — there is no separate `tsc` build step. `build/` is generated output (gitignored).

The green-bar invariant is **`bun check` clean** before any commit.

## First launch

1. App boots, mounts the splash view, prompts for sign-in or create-account.
2. Account row + password hash (argon2id, via `Bun.password`) land in SQLite at:
   - macOS: `~/Library/Application Support/StudioLive/studio.db`
   - Linux: `~/.config/studio-live/studio.db`
   - Windows: `%APPDATA%\StudioLive\studio.db`
3. On subsequent launches the user is restored from `localStorage["studio.currentUserId"]` (sticky session) and the studio mounts directly.
4. Existing localStorage state from before SQLite was added is **auto-migrated** into the new account on first login, then cleared.

## Architecture

Two processes connected by typed RPC:

```
Bun main      src/bun/                      SQLite, ffmpeg, file dialogs, transcript tail
  │ RPC
webview       src/mainview/                 studio UI, agents, mixers
  ├─ auth          login + secrets cache
  ├─ views         splash, studio shell
  ├─ state         persistence + reactive store + source factory
  ├─ components    base class, primitives, dialogs, tiles, perf HUD
  ├─ core          ids (branded), errors (typed)
  ├─ renderers     camera / screen / mic / voice* (strategy per Participant.kind)
  ├─ tts           streaming + buffered providers (ElevenLabs / OpenRouter / Suno)
  ├─ banter        engine + tools + tool-executor + Twitch IRC + VAD
  ├─ transcription audio worklet (Blob URL) + OpenRouter STT
  ├─ streaming     audio mixer, music, overlays (chat/captions/stream/qr), stream engine, egress
  └─ transcript    Bun-tail JSONL feed
```

### Bun ↔ renderer RPC

The schema (`PhotoBoothRPC`) is **defined and exported in `src/bun/index.ts`**, imported by `src/mainview/rpc.ts` as a type-only import. `rpc.ts` constructs the `Electroview` and exports `bunRpc` — every renderer-side caller goes through it.

Adding a new IPC call: extend the schema in `src/bun/index.ts`, implement the handler there, then `await bunRpc.<method>({...})` from the renderer.

### Asset loading

Webview HTML / CSS / images load via `views://`. For a file to be reachable at `views://mainview/foo.css`, it must be declared in `electrobun.config.ts` under `build.views` (TS entrypoints) or `build.copy` (static assets). There is intentionally **one** `index.html` + **one** `index.css` to keep the copy map small; TypeScript splits freely because the bundler resolves imports.

### Platform entitlements (macOS)

`electrobun.config.ts` declares:
- `com.apple.security.device.camera` — webcam sources
- `com.apple.security.device.audio-input` — mic sources (required for external-voice agents + mic transcription)

Linux uses CEF (`bundleCEF: true`). `getDisplayMedia` behavior diverges from WKWebView; `renderers/screen-renderer.ts` feature-detects.

## Renderer-side architecture

### Component model

Vanilla TS base class in `src/mainview/core/component.ts`. Each component:
- `mount(parent)` / `setState(patch)` / `destroy()` lifecycle
- `rootClass()` (CSS class on its root div), `template()` (HTML string), `bind()` (event listeners)
- `this.on(target, event, handler)` for auto-cleaned listeners
- `this.$/this.$$` for scoped queries

No virtual DOM. `setState` re-renders. For hot paths override `update()` and mutate the DOM directly (see `ToolRail`'s rAF speaking-ring loop).

### State

Single global store at `state/studio-store.ts`. Subscribers slice via `studio.select(selector, listener)`.

**Cleanup registry**: when source-factory creates a participant, it registers a teardown callback (revoke Blob URL, dispose TTS provider, stop media tracks, remove mixer channel, stop banter session). `removeParticipant(id)` runs the cleanup before mutating state. This is how blob URLs from VRM/GLB picks get freed and how banter sessions for deleted agents stop reaching out to OpenRouter.

**Persistence**: debounced 400ms saves through `state/persistence.ts` → Bun's `userSaveState` RPC → SQLite. A `beforeunload` listener flushes any pending save before window close.

Don't mutate `studio.state` directly — use the typed mutators (`addParticipant`, `setLayout`, `reorderScenes`, `setStream`, etc.). All take immutable patches and produce identity-changing updates so `select` reacts correctly.

### Branded IDs (`core/ids.ts`)

`UserId`, `ParticipantId`, `SceneId`, `OverlayId`, `MusicTrackId`, `ToolCallId`, `ViewportId`. All compile-time-branded strings — at runtime they're plain strings; at compile time, passing a `SceneId` where a `ParticipantId` is expected is a type error.

Mint via the per-brand constructor (`participantId(s)`) or the generic helper (`mintId("p", participantId)` for `p-<uuid8>`).

### Error model (`core/errors.ts`)

```
StudioError (.userMessage)
├─ ApiError (status + service + body, friendly-message-by-status)
├─ ConfigError
├─ AudioError
├─ RendererError
├─ IpcError
├─ AuthError
├─ PersistenceError
└─ ToolInvocationError
```

Every fallible operation throws a `StudioError` subclass. Toasts call `userMessageFor(err)` which picks the friendly message; logs see the technical `.message`.

### Participant tiles & renderer strategy

`ParticipantTile` swaps a `Renderer` (strategy interface in `renderers/renderer.ts`) based on the participant's `kind`. Renderer cache keyed off a **signature** (`kind|modelUrl|imageUrl|videoDeviceId`) so asset swaps trigger a rebuild instead of a cheap `update()`.

| Kind | Renderer | What it does |
|---|---|---|
| `camera` | `camera-renderer.ts` | Webcam via `getUserMedia({video, audio?})`. Optional mic pairing at creation time. |
| `screen` | `screen-renderer.ts` | `getDisplayMedia` with feature-detection fallback. |
| `mic` | `mic-renderer.ts` | Audio-only. Device picked upfront. The "join like a normal user" path for external-voice agents (BlackHole / VB-Audio / virtual cable). |
| `voice` | `voice-renderer.ts` | Radial equalizer keyed to amplitude. |
| `voice-image` | `image-renderer.ts` | Static image with amplitude pulse. |
| `voice-vrm` | `vrm-renderer.ts` | three.js + `@pixiv/three-vrm`. `aa` blendshape from amplitude. Idle-throttled to 10fps. |
| `voice-glb` | `glb-renderer.ts` | three.js GLTFLoader. Idle/talking clip crossfade or jaw-bone scale. |

Renderers expose `getFrameSource(): CanvasImageSource` so `StreamEngine` can composite the active scene's tiles onto an output canvas — that canvas is what `captureStream()` feeds to MediaRecorder → ffmpeg.

### Audio mixer

`streaming/audio-mixer.ts` — single owner of the WebAudio graph. One shared `AudioContext`. Every participant routes through it:
- Humans/mic/camera: source factory creates a `MediaStream` (`getUserMedia`); the participant tile calls `audioMixer.addInput(id, stream)` and gets an `AnalyserNode` back.
- In-house TTS agents: provider creates a `MediaStreamAudioDestinationNode` in `audioMixer.ctx`, returns its `.stream`; same path.

`addInput` accepts either `MediaStream` or `AudioNode` and tracks ownership so `removeInput` doesn't tear down provider-owned graph nodes.

ToolRail's speaking-ring loop and `LipSync` share the same analysers.

### TTS provider system

Two base classes:
- `BaseTTSProvider` (`tts/base-provider.ts`) — buffered: `synthesize(text)` returns whole audio bytes, base decodes via `decodeAudioData` and plays via one `BufferSourceNode`. Used for **Suno**.
- `StreamingTTSProvider` (`tts/streaming-provider.ts`) — chunked: `synthesizeStreaming(text, onChunk, signal)` calls `onChunk(int16)` as PCM frames arrive. `StreamingAudioScheduler` (`tts/streaming-scheduler.ts`) schedules each chunk at the running playhead for gapless playback. Used for **ElevenLabs** and **OpenRouter**.

Three providers:
- `elevenlabs-tts.ts` — WebSocket `stream-input` endpoint, `output_format=pcm_22050`. Sub-200ms first-byte.
- `openrouter-tts.ts` — `/chat/completions` with `stream: true`, `modalities: ["text","audio"]`, `audio.format: "pcm16"`. SSE stream of base64 PCM 24kHz mono chunks. Default model `openai/gpt-4o-audio-preview`, voice `alloy`. Wraps user text as "Say exactly the following: …" so the model passes it through.
- `suno-tts.ts` — POST `/api/v1/generate` → poll `/api/v1/generate/record-info` → fetch MP3. **30–120s latency**; use for jingles / agent songs / intros.

`tts/registry.ts` maps `participantId → provider`. API keys live in the per-user **secrets cache** (`auth/secrets-cache.ts`), hydrated from SQLite at login. Readers stay synchronous so providers don't need to thread `await` through every call site; writes persist via RPC.

### Banter engine + tool calling

`banter/banter-engine.ts` drives a per-agent loop:
- Reads Twitch chat (`banter/twitch-chat.ts`, anonymous IRC over WSS).
- Optionally reacts to coding-transcript events (idle proactive path) — `IDLE_QUIET_BEFORE_MS = 25s`, only when chat is quiet + new transcript events since last comment.
- Optionally consumes mic transcripts as `[host]: ...` synthetic chat messages (when `voiceContext` enabled).
- Routes replies through the agent's TTS provider.
- VAD gate (`banter/vad.ts`) pauses the agent while a non-agent participant is speaking.
- **AbortSignal threaded through every LLM call** — `stop()` aborts in-flight respond cycles instead of letting tokens keep flying.

The LLM is OpenRouter-only; the OpenRouter key from TTS storage is reused. Default model `openrouter/free` — a routing model that filters to free-tier models supporting the request's required capabilities (including tools).

Tools (`banter/tools.ts`, `banter/tool-executor.ts`):
- Discriminated `ToolInvocation` union with `parseToolInvocation(name, raw)` validator at the boundary. Bad shapes from the LLM ship a validation error back through the `tool` channel so it self-corrects.
- `show_overlay` / `remove_overlay` / `list_overlays` — drive `streaming/stream-overlays.ts`. Per-kind default lifetimes (notice 6s, title-card 60s, code-snippet 90s, lower-third 120s) prevent drift; `sticky: true` opts into "never auto-dismiss."
- `play_music` / `stop_music` / `set_music_volume` — drive `streaming/music-player.ts` + `music-generator.ts`. `play_music` is **non-blocking**: returns `{status:"queued"}` immediately and crossfades the track in when Suno finishes.

### Mic transcription → banter context

`transcription/mic-transcriber.ts` is a singleton:
- `AudioWorkletNode` with the processor source as a string + Blob URL (no separate worklet file needed).
- RMS gating + silence-based batching decides utterance boundaries.
- POSTs WAV to OpenRouter's `/api/v1/audio/transcriptions` (cleaner shape than chat completions; returns `usage.cost`).
- Default model `google/gemini-2.5-flash` (~$0.04/hr of speech). Swap to `openai/whisper-1` for higher accuracy.
- 14 utterances/minute rate limit as a budget guard.
- Cumulative USD cost exposed via `getStats()`; rendered in the perf HUD.
- Reference-counted by banter sessions. First subscriber starts the singleton; last unsub tears it down.

Auto-discovers a non-agent audio source (mic kind or camera+mic combo) and re-attaches if one appears mid-session.

### Stream engine + egress

`streaming/stream-engine.ts` composites the active scene onto a canvas at the preset's resolution + fps. `captureStream()` + mixer audio = one MediaStream.

**Local disk recording** (`streaming/recorder.ts` + Bun `startRecordingFile` / `writeRecordingChunk` / `finishRecordingFile`) uses the **same** composited canvas + mixer audio as egress. MediaRecorder still emits **WebM** (VP8/9 + Opus); chunks are written to a **temp WebM** under the OS temp directory, then on stop Bun runs **ffmpeg** (`recording-transcode.ts`) to produce an **H.264 + AAC MP4** (`+faststart`) at the path you chose. Any tile the engine can draw — including a **screen** participant (`getDisplayMedia` → `ScreenRenderer`'s `<video>` as `CanvasImageSource`) — appears in the recording as long as that source is in the active scene and visible. Screen rows use **video only** from the picker (`audio: false` in `screen-renderer.ts`); system/tab audio from the share is not captured unless the user routes it through mic/virtual cable. Chunk writes are **serialized** so the last `dataavailable` blob is flushed before the staging file is closed and transcoded.

`streaming/presets.ts` defines tiers (480p / 720p / 1080p) with per-tier MIME, fps, bitrate. `pickSupportedMime()` falls back to VP8 if VP9 isn't supported by the runtime.

`streaming/egress.ts` is the renderer-side egress controller:
1. User opens the RTMP dialog (`rtmp-config-dialog.ts`) → adds one or many destinations → Go Live.
2. Renderer RPCs `bunRpc.startStreamEgress({ destinations: [...] })`.
3. Bun spawns ffmpeg with hardware-encoder auto-detection (`videotoolbox` / `nvenc` / `vaapi` / `qsv` / `amf` / `libx264` fallback). For multiple destinations, ffmpeg's **`tee` muxer** fans the same encode out to all of them — single encode cost, multiple platforms.
4. Renderer wraps the composited stream with `MediaRecorder` at 1-second WebM slices and ships each blob to Bun via `bunRpc.pushStreamChunk({ base64 })`. Bun pipes raw bytes to ffmpeg's stdin.
5. Stop → renderer awaits the final `dataavailable`, then `stopStreamEgress` → Bun closes ffmpeg's stdin and waits for it to drain.

**ffmpeg must be on PATH** for egress to work — error toast surfaces clearly if it isn't.

### Overlays (broadcast graphics)

All overlays draw onto the StreamEngine canvas — they reach the broadcast, never the local preview tiles.

| Module | Purpose |
|---|---|
| `streaming/chat-overlay.ts` | Twitch chat panel. Independent from banter. Configurable channel + position + visible-message count. |
| `streaming/stream-overlays.ts` | Generic registry: title cards, notices, code snippets, lower-thirds. Per-kind auto-dismiss. |
| `streaming/captions-overlay.ts` | Live captions from the mic transcriber. Toggled via tool rail. |
| `streaming/qr-overlay.ts` | QR codes (via `qrcode` package). Cached as `<img>` once generated. |

### Persistence

`state/persistence.ts` serializes `StudioState` to JSON → SQLite (per user). Drops:
- Runtime fields: `MediaStream`, `audioStream`, `recording`, `live`
- Blob-URL `modelUrl` / `imageUrl` (the Blob is gone after reload — Edit → "Replace model" recovers)
- Transient overlays with an `expiresAt` set

Re-attaches:
- Banter sessions auto-resume if `banter.enabled`
- Chat overlay auto-resumes if enabled
- Transcript watcher auto-resumes if a path is set
- Music re-fetches from remote URLs (Suno hosted MP3s) after the first user gesture; blob URLs are dropped

## Testing

`bun test` (or `bun check` for typecheck + tests).

Co-located `*.test.ts` files. 7 files, 37 tests covering:
- `wav-encoder.test.ts` — RIFF header bytes, sample clamp, byte length
- `presets.test.ts` — preset values, MIME fallback
- `store.test.ts` — subscribe / select / unsubscribe
- `twitch-chat.test.ts` — IRC line parser
- `streaming-scheduler.test.ts` — playhead advancement, stop cancellation
- `persistence.test.ts` — round-trip, blob stripping, version mismatch
- `bun/db/users.test.ts` — signup / login / delete (in-memory SQLite via `setDbForTesting`)

DOM-needing modules (`stream-overlays`, `tool-executor`, `transcript/feed`) are skipped — would need happy-dom integration, separate concern.

## Adding things

### A new TTS provider

1. Create `src/mainview/tts/<name>-tts.ts` extending `BaseTTSProvider` (buffered) or `StreamingTTSProvider` (chunked). Implement `synthesize()` / `synthesizeStreaming()`.
2. Add the id to `TTSProviderId` union in `core/types.ts`.
3. Add a `case` in `tts/registry.ts::build()`.
4. Add a `ProviderSchema` entry in `tts/config-dialog.ts` describing which fields the dialog shows.
5. Add to `KEY_STORAGE` indirectly via the secrets-cache key (use the provider id).

### A new agent tool

1. Add an entry to `BANTER_TOOLS` in `banter/tools.ts`.
2. Extend the `ToolInvocation` discriminated union with the typed args.
3. Add a case to `parseToolInvocation` that validates raw args.
4. Add a case to `banter/tool-executor.ts::execute()`.

### A new SourceKind

1. Add to `SourceKind` union in `core/types.ts`.
2. Build the renderer in `renderers/<kind>-renderer.ts`.
3. Register it in `renderers/index.ts::createRenderer`.
4. Add a `case` in `state/source-factory.ts` for asset acquisition.
5. Surface in the Add Source popover in `components/stage-controls.ts`.

### A new auth-protected RPC

1. Add the schema entry in `src/bun/index.ts` PhotoBoothRPC.
2. Add the handler. Take `userId` as a param and look up via the db helpers.
3. Call from the renderer via `bunRpc.<method>({...})`.

## Gotchas

- **AudioContext gesture lock** — Providers call `audioMixer.resume()` inside `speak()` because the context starts suspended until a user gesture. `mountShell` also arms a one-shot click listener as a safety net.
- **Blob URLs** — Picked VRM/GLB models become Blob URLs. Cleanup callback in the participant registry revokes them on `removeParticipant`. They don't survive reload — persistence strips them and the user re-attaches via Edit → Replace model.
- **`Uint8Array` generics** — `getByteFrequencyData` wants `Uint8Array<ArrayBuffer>` (concrete, not `ArrayBufferLike`). Use `new Uint8Array(new ArrayBuffer(N))`.
- **macOS mic permission** — Requires the `audio-input` entitlement AND the runtime grant. Without the entitlement, the prompt never appears.
- **Grid layout** — `AppHeader`, `ScenePanel`, `ToolRail` carry the `grid-area` CSS on their own root class. `mountShell` mounts them directly into `#app` — adding a wrapper div breaks placement.
- **Tool-calling compatibility** — `openrouter/free` is filtered to tool-capable models. If a user swaps to a specific model that doesn't support tool calls, the LLM responds with regular text and `runToolLoop` gracefully degrades to speak-only.
- **Music persistence** — Remote URLs (Suno MP3s) re-fetch after the first user gesture on boot. Blob URLs can't survive reload; they're cleared.
- **ffmpeg on PATH** — Required for RTMP egress. Install via `brew install ffmpeg` or distro equivalent.

## Out of scope

- Cloud sync / remote accounts — explicitly OSS local-first. The SQLite file is portable; back it up to move accounts between machines.
- Account password reset — local-only auth has no reset. Delete the DB and sign up again, or alter the `users` row directly.
- Captions / QR / Theme / Help dialogs were originally marked out-of-scope; all four are implemented as of Stage 2.

## Security model

Same as VS Code / Cursor / every other local-first desktop app:
- Password hashed with argon2id (`Bun.password`).
- API keys + RTMP creds stored plaintext in `user_secrets` table.
- Anyone with read access to the user's `~/Library/Application Support/StudioLive/studio.db` (or equivalent) can read everything in it.
- Mitigate with full-disk encryption (FileVault / BitLocker / LUKS) — same threat model as your shell history.
- "Session" is `localStorage["studio.currentUserId"]`. No session tokens — single user per process.

### Why secrets aren't encrypted at rest

We considered encrypting `user_secrets` with a key derived from the user's password. Decided against it because the threat doesn't actually narrow:

1. The renderer needs decrypted keys in memory anyway (TTS providers call APIs synchronously after login), so a memory-dump or malicious process on the box still reads them.
2. The Electrobun webview has no OS keychain access path that doesn't add a native dep — and a keychain entry on macOS is readable by any process running as the user, same as the DB.
3. Password-derived encryption only buys protection against *cold* disk reads (lost laptop, backups copied), which is exactly what full-disk encryption already covers on every modern OS.
4. The cost is real: every provider read becomes async + decrypt, lockout on forgotten password becomes catastrophic (no recovery), and the in-memory cache duplicates the cleartext anyway.

If a future deployment scenario actually needs encrypted-at-rest secrets (shared workstation, no FDE, regulatory check-the-box), the place to add it is `src/bun/db/state.ts` — wrap `getSecret`/`setSecret` with `crypto.subtle.encrypt` keyed off a PBKDF2-derived key established at login. The cache layer in `src/mainview/auth/secrets-cache.ts` already gives a one-shot decrypt boundary so providers stay synchronous.
