# ADR 0002 — Local voice model (OmniVoice) proven end-to-end

Date: 2026-05-14
Status: Accepted

## Context

weclank's "local voice model" is the **OmniVoice** carrot — an
on-device TTS path that runs `omnivoice-tts` (a CMake-built C++ binary
from `ServeurpersoCom/omnivoice.cpp`) against Q4_K_M GGUF model weights
stored under `~/.weclank/local-inference/`. The renderer-side
`OmniVoiceTTSProvider` (`src/mainview/tts/omnivoice-tts.ts`) invokes the
`omnivoice` carrot's `synthesize` method via `bunRpc.carrotInvoke`,
which spawns the binary as a subprocess and pipes a one-shot WAV back.

When auditing whether this path actually worked, the build was broken
and had likely been broken since the upstream repo was renamed.

## What was wrong

1. **Stale binary name.** Upstream `omnivoice.cpp` renamed
   `llama-omnivoice-server` → `omnivoice-tts` (long-running HTTP server
   → one-shot CLI). Both `scripts/build-omnivoice.mjs` and
   `carrots/omnivoice/worker.mjs` were still targeting the old name, so
   the cmake build failed with:

   ```
   make: *** No rule to make target `llama-omnivoice-server'. Stop.
   ```

2. **Stale CLI flags in the worker.** The worker passed `--threads`
   (removed in the new CLI), `--flash-attn` (replaced by an opt-out
   `--no-fa`), and `--voice` (replaced by `--ref-wav` + `--ref-text`
   reference-audio voice cloning). Even if the build had produced a
   binary, every synthesize call would have errored.

3. **No end-to-end proof on this machine.** The integration test
   covering the always-on path (install / enable / status) ran, but the
   actual synthesize path was gated behind `WECLANK_OMNIVOICE_E2E=1`
   and had never been verified locally.

## What was changed

- `scripts/build-omnivoice.mjs`: now targets `omnivoice-tts` (primary)
  and `omnivoice-codec` (sibling tool, kept for the voice-clone debug
  paths). Drops the spurious `-DOV_WEBSERVER=ON` flag and the warning
  shim for the `omnivoice` shared-library target that no longer exists.
  Artifact copier picks up both binaries.
- `carrots/omnivoice/worker.mjs`: spawns `omnivoice-tts`, drops
  `--threads` and `--voice`, converts `--flash-attn` to a conditional
  `--no-fa` opt-out, and updates the build-not-yet error message.
- `src/mainview/tts/omnivoice-tts.ts`: drops `voice` from the params
  sent to the carrot. The `OmniVoiceTTSOptions` interface keeps `voice`
  as a reserved field with a comment explaining the upstream change so
  future reference-audio voice cloning can land cleanly.

## End-to-end proof

Verified on `darwin/arm64` (Apple Silicon, Metal backend) at the time
of this ADR:

1. `bun run build:omnivoice` — clones `omnivoice.cpp@master`,
   cmake-configures with Metal, builds both targets. Produces:
   - `~/.weclank/local-inference/bin/omnivoice-tts` (≈ 394 KB)
   - `~/.weclank/local-inference/bin/omnivoice-codec` (≈ 339 KB)

2. `WECLANK_OMNIVOICE_E2E=1 bun test src/bun/carrots/omnivoice.integration.test.ts`
   — both tests pass in 48.78 s:
   - `install → enable → status invoke → uninstall` (always-on)
   - `synthesize returns a real RIFF WAV when artifacts exist`
     (downloads ~660 MB of GGUF weights on first run, asserts the
     leading 4 bytes of the returned base64 payload are `RIFF`).

   Models on disk after the run:
   - `omnivoice-base-Q4_K_M.gguf` — 407 MB
   - `omnivoice-tokenizer-Q4_K_M.gguf` — 252 MB

3. `scripts/smoke-omnivoice.sh` — re-runnable smoke that does the same
   three phases end-to-end (build if missing → lifecycle test → E2E
   synthesize). Suitable for a manual re-check before a release.

4. `bun check` — green-bar clean: 296 pass · 5 skip · 0 fail · TS
   clean · biome clean.

## Consequences

- The local voice model is now genuinely callable from the renderer:
  `OmniVoiceTTSProvider.speak()` → carrot → binary → WAV → audio
  mixer.
- First-time use will block on the model download (~660 MB) and the
  binary build (5–10 min on M-series). Both are idempotent; subsequent
  starts are sub-second.
- `WECLANK_OMNIVOICE_E2E` remains the gate for the heavy test. CI must
  not set it without provisioning the disk + build time.
- Voice cloning via `--ref-wav` + `--ref-text` is not wired through
  the renderer yet. When it lands, the `voice` field on
  `OmniVoiceTTSOptions` can be repurposed (or a separate `referenceWav`
  + `referenceText` pair added).
