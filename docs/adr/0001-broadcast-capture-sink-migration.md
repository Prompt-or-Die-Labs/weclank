# ADR 0001 — Broadcast capture sink migration; deferred deepenings

Date: 2026-05-14
Status: Accepted

## Context

An architectural review of `weclank` identified six candidate deepening
opportunities (modules where the interface looked shallow against the
implementation, or where a single CONTEXT.md concept appeared spread
across multiple files). Reading the actual code showed that most of the
fragmentation the review surfaced had already been addressed by recent
in-flight refactors. One real deepening remained: two consumers of the
broadcast-capture module were still using a deprecated back-compat shim
instead of the deep `CaptureSink` interface that the module already exposed.

## Decision

### Shipped

**Broadcast capture sink migration.** Removed the `startBroadcastCapture`
shim and the `BroadcastCaptureSession` interface from
`src/mainview/streaming/capture.ts`. Migrated both consumers
(`streaming/egress.ts` and `streaming/recorder.ts`) to construct a
`CaptureSink` and call `broadcastCapture.attach(sink, opts)` /
`broadcastCapture.detach(sinkId)` directly.

Effects:

- **Drain semantics moved into the sink contract.** `CaptureSink.onStop`
  is awaited by `detach` after the final `dataavailable` flushes, so each
  consumer's write-chain drain is now a one-line `await this.writeChain`
  inside `onStop`. Recorder no longer needs `drainChunkWrites` polling,
  `RECORDER_FINAL_CHUNK_GRACE_MS`, or `acceptingChunks` racing.
- **Final chunk delivery is guaranteed by the interface.** Detach blocks
  until `stopRecorder` resolves (which awaits MediaRecorder's final
  `dataavailable`), then awaits `onStop`. Consumers no longer race
  teardown against in-flight chunks.
- **One fewer shim.** Removed ~30 lines of legacy adapter code from
  `capture.ts`.

Tests stay green (258 pass, 0 fail). `capture.test.ts` was migrated to
use the new interface (its unique "periodic requestData flushing stops
after detach" scenario was preserved). `broadcast-capture.test.ts`
already exercises the sink API directly.

### Deferred / not needed

The following candidates from the review were deferred. Future
architecture reviews should consult this section before re-suggesting them.

**1. Voice participant slice inside Participant runtime — already done.**
`state/participant-runtime.ts` already owns the disposal ordering
(banter → voice route → mixer → media tracks → blob URLs → renderer) as
a single deep module. `tts/registry.ts` already folded in
`tts/voice-route.ts` (deleted in the same in-flight pass) so the
provider/mixer/state binding lives in one file. The fragmentation the
review described was outdated.

**2. Overlay plane routing.** `streaming/overlay-plane.ts` is already a
deep registry — built-in sources (`stream-overlays`, `chat-overlay`,
`captions`) self-register at module load and the plane handles z-order +
the draw loop. The proposal to route tool-executor calls
(`show_overlay` / `show_caption` / `show_qr`) "through the plane"
conflates two seams that are correctly distinct: **the plane is a
draw-time z-order registry**; **tool-executor exposes content-time tool
APIs**. Unifying them would force each LLM tool to know about z-index
ordering, which is not its concern.

**3. SceneCompositor module.** `state/scene-composition.ts` is already a
deep module of pure functions covering placement, layout presets, hit
testing, resize/move math, and backstage entries. Merging it with the
store's scene mutators would couple deterministic geometry math to the
reactive store and make the math harder to test in isolation — the
opposite of a deepening.

**4. Chat connectors.** `chat/chat-connector.ts` already defines the
`ChatConnector` interface; `chat/chat-bus.ts` orchestrates one
connector per platform and shares the same fan-out path. The
platform-specific protocols (Twitch IRC, Kick Pusher, YouTube REST) are
genuinely different and cannot be meaningfully unified beyond the
existing interface. Shared reconnect logic lives in `core/retry`
(`reconnectLoop`) and is used by `KickConnector`. `TwitchConnector`
relies on the underlying `TwitchChatSource` for reconnection — a small
follow-up could route Twitch through `reconnectLoop` for consistency,
but that is incremental, not a structural deepening.

**5. Producer "processors" — unified `StreamProcessor` interface.**
Rejected as the wrong abstraction. The three modules
(`producer/content-engine.ts` → `producer/stream-analytics.ts` →
`producer/shortform.ts`) are a **pipeline**, not parallel processors:
`stream-analytics` consumes `content-engine`'s output;
`shortform` consumes both. They have intentionally different shapes
because they are sequential stages, not interchangeable adapters. A
unified `StreamProcessor` interface would impose a contract that doesn't
fit any of them. (`producer/run-of-show.ts` is a separate concern — state
CRUD for show segments, not a processor at all.)

## Consequences

- Future deepening reviews of these subsystems should reopen the question
  only if behavior changes — new participant kinds, new chat platforms,
  new overlay categories, new producer pipeline stages. The structures
  documented above are deliberate.
- The Twitch-via-`reconnectLoop` consistency follow-up is left as a
  potential small fix, not a deepening.
- `capture.ts` is now the single source of truth for the capture seam.
  New consumers must implement `CaptureSink` and use `attach` / `detach`
  directly.
