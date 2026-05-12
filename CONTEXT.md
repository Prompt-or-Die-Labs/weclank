# Weclank Domain Context

Weclank is a local-first streaming studio with AI co-hosts. The app moves from splash to local account login to the studio, where a user builds scenes, adds participants, produces a broadcast canvas, and optionally sends that broadcast to local recording or RTMP destinations.

## Terms

**Participant** — a local source that can appear in scenes. Participants include camera, screen, mic, voice agents, avatar agents, and text assistants.

**Scene** — an ordered composition of participant placements. A scene decides which participants are on the broadcast canvas, their geometry, their visibility, and their z-order.

**Source placement** — a participant's normalized rectangle inside a scene. Placement coordinates are ratios of the broadcast canvas so scenes survive resolution changes.

**Scene composition** — the rules for source placement, z-order, visibility, hit-testing, layout presets, and backstage projection.

**Backstage** — participants that are not currently visible on the active scene, either because they are absent from the scene or present but hidden.

**Participant runtime** — disposable resources attached to a participant at runtime: media streams, TTS providers, audio mixer inputs, renderers, and banter sessions.

**Agent turn** — one decision cycle for an AI co-host: consume an event, apply gates and context, call the LLM/tools, emit a reply, and optionally speak.

**Broadcast capture** — the MediaRecorder pipeline that captures the broadcast canvas plus mixed audio for local recording or RTMP egress.

**Broadcast overlay plane** — the ordered graphics pass drawn on top of participant tiles before capture: chat, generated overlays, QR codes, and captions.
