# Weclank

[![CI](https://github.com/Prompt-or-Die-Labs/weclank/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Prompt-or-Die-Labs/weclank/actions/workflows/ci.yml)
[![Release](https://github.com/Prompt-or-Die-Labs/weclank/actions/workflows/release.yml/badge.svg)](https://github.com/Prompt-or-Die-Labs/weclank/actions/workflows/release.yml)
[![Latest release](https://img.shields.io/github/v/release/Prompt-or-Die-Labs/weclank?include_prereleases&sort=semver)](https://github.com/Prompt-or-Die-Labs/weclank/releases/latest)

AI co-host for coding livestreams.

**Latest build** → <https://github.com/Prompt-or-Die-Labs/weclank/releases/latest> (macOS arm64, Linux x64, Windows x64 — auto-built on every merge to `main`).

One binary. No cloud project. Your machine, your data — accounts, scenes, agents, transcripts, and stream state stay local. Secrets use macOS Keychain when available and local SQLite elsewhere.

## What it does

- **Coding-aware co-host** — tails Claude Code or Codex JSONL sessions so the agent can react to tool calls, edits, and terminal work instead of riffing from generic chat.
- **Host + chat context** — reads viewer chat, listens to your mic when enabled, pauses while you speak, and replies through text or streaming TTS.
- **Overlay cueing** — lets the co-host drive title cards, lower-thirds, code snippets, notice toasts, captions, QR codes, and music from the same tool loop.
- **Post-stream habit loop** — records the program feed, opens review, and drafts recap assets from run-of-show, transcript feed, chat, and co-host actions.
- **Broadcast path when needed** — webcams, screens, mics, scenes, hardware-encoded RTMP egress, and multistream fan-out via ffmpeg's `tee` muxer.
- **Local accounts** — argon2id passwords, per-user state, local-only sign in/out/delete-account flows.

Weclank is not trying to be a general OBS replacement. The product bet is the coding-stream co-host loop: transcript awareness, host mic context, chat response, overlay cueing, recording review, and post-stream output.

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

## macOS first-run

Release builds are ad-hoc signed, not notarized — running them on Apple Silicon costs $99/yr we haven't spent. macOS Gatekeeper marks any unsigned app downloaded from the internet as "damaged" on first launch. Clear the quarantine bit once and the app runs normally:

```sh
xattr -dr com.apple.quarantine /path/to/weclank-canary.app
```

On older macOS versions a right-click → **Open** also works (the prompt offers an "Open Anyway" button that double-click doesn't). Same threat-model story as any open-source Mac app distributed outside the App Store — VS Code OSS, OBS dev builds, etc. all hit the same flow.

## Where your data lives

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/Weclank/studio.db` |
| Linux | `~/.config/weclank/studio.db` |
| Windows | `%APPDATA%\Weclank\studio.db` |

The file is mode 0600 (user-only). It's plain SQLite — back it up, copy it to another machine, inspect it with any SQLite tool.

## Configure

Set provider keys in-app:

- **OpenRouter** — default banter LLM, TTS, and audio transcription. Default model `openrouter/free` auto-routes to free tool-capable models. Sign up at [openrouter.ai/keys](https://openrouter.ai/keys).
- **ElevenLabs** — optional, for streaming TTS with sub-200ms latency. Sign up at [elevenlabs.io](https://elevenlabs.io).
- **Suno** — optional, for AI music generation. Uses [api.sunoapi.org](https://docs.sunoapi.org) by default.

On macOS, new secrets are stored in Keychain and referenced from SQLite. On Linux and Windows, secrets are stored in the local SQLite account file for now. Legacy plaintext SQLite rows still load so older accounts keep working after upgrade.

For coding-feed context, point the Coding panel at your active Claude Code / Codex JSONL session — or hit "Auto-detect newest session" to find it.

For multistream, the RTMP dialog (right of the Go Live button) lets you add multiple destinations:

- Twitch: `rtmp://live.twitch.tv/app` + your stream key
- YouTube: `rtmp://a.rtmp.youtube.com/live2` + your stream key

## Architecture (one paragraph)

Electrobun desktop app — Bun runs the main process (SQLite, Keychain bridge, ffmpeg, file dialogs, transcript tail); a single webview renders the studio (state store, components, renderers, mixers). Typed RPC between them. See `CLAUDE.md` for the full subsystem map.

## Build

```sh
bun build                # production canary bundle (alias of build:canary)
bun build:canary
```

Output lands in `build/` — gitignored. Hardware encoder auto-detection means the same binary works across macOS / Linux / Windows.

## Releases

Merging to **`main`** automatically creates the next **`v*`** tag (unless the merge commit says **`[skip release]`**), which triggers CI to build macOS / Linux / Windows artifacts and publish a **GitHub Release**. You can also run **Actions → Auto-tag release** manually or push a tag by hand. Details: [RELEASING.md](./RELEASING.md).

## Test

```sh
bun test                 # co-located *.test.ts
bun test:watch           # rerun on save
bun lint                 # Biome lint (no formatter — see CONTRIBUTING)
```

CI runs `bun check` on every push and PR via `.github/workflows/ci.yml`. Pushes to `main` run `.github/workflows/auto-release-tag.yml` (then `release.yml` when a new tag appears).

## License

Apache 2.0. Use it, fork it, sell a hosted version of it — the only ask is keep the LICENSE notice.

## Contributing

The codebase is laid out for extension. To add a new TTS provider, agent tool, source kind, or RPC, the recipes are in `CLAUDE.md`. Green-bar (`bun check`) must stay clean — typecheck + lint + tests, no exceptions.

If you're a Claude Code / Codex / Cline user — pointing the Coding panel at your own session makes the studio's banter agent narrate your work back to viewers in real time. That's the use case it was built for.
