# Weclank

Open-source local-first streaming studio with AI co-hosts.

One binary. No cloud. Your machine, your data — every account, scene, agent, and API key lives in a SQLite file on your disk.

## What it does

- **Multi-source compositing** — webcams, screens, mics, AI participants. Drag-reorder scenes, pick layouts, RTMP egress with hardware encoding (videotoolbox / nvenc / vaapi / qsv auto-detected).
- **Multistream** — fan a single encode to Twitch + YouTube + a local mirror via ffmpeg's `tee` muxer. One CPU cost, many platforms.
- **AI co-host** — a banter agent that:
  - reads viewer chat (anonymous Twitch IRC) and replies via streaming TTS (ElevenLabs / OpenRouter / Suno),
  - listens to your microphone (OpenRouter audio transcription) so it knows what you just said,
  - tails your Claude Code or Codex JSONL session so it reacts to actual coding work,
  - drives stream overlays + music + captions via OpenAI-style tool calling,
  - pauses when you speak (VAD gate),
  - speaks unprompted when chat is quiet but your AI coder is working.
- **Visual broadcast layer** — title cards, lower-thirds, code snippets, notice toasts, chat overlay, live captions, QR codes — all rendered onto the broadcast canvas (not the local preview).
- **Per-user accounts** — argon2id passwords, per-user secrets + state in SQLite. Sign in / out / delete-account flows. Local-only, no remote.

## Install

```sh
bun install
```

You also need:

- **Bun** ≥ 1.3 ([bun.sh](https://bun.sh))
- **ffmpeg** on `$PATH` — for RTMP egress
- **Inter** and **JetBrains Mono** fonts installed (optional — the UI falls back to system stacks)

## Run

```sh
bun dev                  # development with file watching
bun start                # one-shot run
bun check                # green-bar gate (typecheck + lint + tests)
```

First launch: splash → create-account → studio. Sticky login on subsequent launches.

## Where your data lives

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/Weclank/studio.db` |
| Linux | `~/.config/weclank/studio.db` |
| Windows | `%APPDATA%\Weclank\studio.db` |

The file is mode 0600 (user-only). It's plain SQLite — back it up, copy it to another machine, inspect it with any SQLite tool.

## Configure

API keys live in your account's `user_secrets` table — set them in-app:

- **OpenRouter** — required for the banter agent (LLM + audio transcription). Default model `openrouter/free` auto-routes to free tool-capable models. Sign up at [openrouter.ai/keys](https://openrouter.ai/keys).
- **ElevenLabs** — optional, for streaming TTS with sub-200ms latency. Sign up at [elevenlabs.io](https://elevenlabs.io).
- **Suno** — optional, for AI music generation. Uses [api.sunoapi.org](https://docs.sunoapi.org) by default.

For coding-feed context, point the Coding panel at your active Claude Code / Codex JSONL session — or hit "Auto-detect newest session" to find it.

For multistream, the RTMP dialog (right of the Go Live button) lets you add multiple destinations:

- Twitch: `rtmp://live.twitch.tv/app` + your stream key
- YouTube: `rtmp://a.rtmp.youtube.com/live2` + your stream key

## Architecture (one paragraph)

Electrobun desktop app — Bun runs the main process (SQLite, ffmpeg, file dialogs, transcript tail); a single webview renders the studio (state store, components, renderers, mixers). Typed RPC between them. See `CLAUDE.md` for the full subsystem map.

## Build

```sh
bun build:canary         # production canary build
```

Output lands in `build/` — gitignored. Hardware encoder auto-detection means the same binary works across macOS / Linux / Windows.

## Test

```sh
bun test                 # 73 tests across 12 files in ~700ms
bun test:watch           # rerun on save
bun lint                 # Biome lint (no formatter — see CONTRIBUTING)
```

CI runs `bun check` on every push and PR via `.github/workflows/ci.yml`.

## License

Apache 2.0. Use it, fork it, sell a hosted version of it — the only ask is keep the LICENSE notice.

## Contributing

The codebase is laid out for extension. To add a new TTS provider, agent tool, source kind, or RPC, the recipes are in `CLAUDE.md`. Green-bar (`bun check`) must stay clean — typecheck + lint + tests, no exceptions.

If you're a Claude Code / Codex / Cline user — pointing the Coding panel at your own session makes the studio's banter agent narrate your work back to viewers in real time. That's the use case it was built for.
