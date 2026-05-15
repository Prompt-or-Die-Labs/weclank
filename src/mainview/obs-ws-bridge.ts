// Renderer-side half of the obs-websocket bridge.
//
// Mirror push: subscribes to studio state; on any change to scene
// list / current scene / live / recording, pushes a flat snapshot to
// Bun. Bun's StudioAdapter reads from that mirror when an obs-ws
// client asks for state.
//
// Command poll: polls Bun for queued commands. Cadence is adaptive
// — Bun returns a `nextPollMs` hint so we tighten to 250ms when
// clients are connected and back off to 5s when nobody's listening.
// Without this, the bridge cost ~4 RPC/sec at idle even with the
// server disabled.

import { bunRpc } from "./rpc";
import { studio } from "./state/studio-store";
import { goLive, startRecording, stopBroadcast, stopRecording } from "./streaming/broadcast-actions";
import { logger } from "./observability";
import { buildObsMirrorSnapshot, type ObsMirrorSnapshot } from "./obs-ws-snapshot";

const FAST_POLL_FALLBACK_MS = 250;
const IDLE_POLL_FALLBACK_MS = 5_000;

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let lastPushSnapshot = "";

function buildSnapshot(): ObsMirrorSnapshot {
	return buildObsMirrorSnapshot(studio.state);
}

async function pushSnapshotIfChanged(): Promise<void> {
	const snap = buildSnapshot();
	const key = JSON.stringify(snap);
	if (key === lastPushSnapshot) return;
	lastPushSnapshot = key;
	try {
		await bunRpc.updateObsMirror(snap);
	} catch (err) {
		logger().withError(err).warn("[obs-ws-bridge] mirror push failed");
	}
}

async function executeCommand(cmd: { type: string; sceneName?: string }): Promise<void> {
	const log = logger().withFields({ component: "obs-ws-bridge", cmd: cmd.type });
	try {
		switch (cmd.type) {
			case "set-current-scene": {
				if (!cmd.sceneName) return;
				const target = studio.state.scenes.find((s) => s.name === cmd.sceneName);
				if (target) studio.activateScene(target.id);
				else log.warn("scene not found");
				break;
			}
			// All four broadcast/record commands route through the
			// shared broadcastActions module. AppHeader's button, the
			// hotkeys, the command palette, and the obs-ws bridge all
			// converge on the same implementation — so behaviors stay
			// in sync regardless of trigger source.
			case "start-stream":
				await goLive();
				break;
			case "stop-stream":
				stopBroadcast();
				break;
			case "start-record":
				await startRecording();
				break;
			case "stop-record":
				stopRecording();
				break;
			default:
				log.warn("unknown obs command");
		}
	} catch (err) {
		log.withError(err).warn("command execution failed");
	}
}

/** Single poll iteration. Returns the cadence (ms) for the next tick
 *  based on Bun's report of how many obs-ws clients are connected. */
async function pollOnce(): Promise<number> {
	try {
		const result = await bunRpc.pollObsCommands({});
		for (const cmd of result.commands) {
			await executeCommand(cmd);
		}
		// nextPollMs is required in the new RPC shape; fall back to the
		// fast cadence if an older Bun returned undefined.
		return result.nextPollMs ?? FAST_POLL_FALLBACK_MS;
	} catch (err) {
		logger().withError(err).warn("[obs-ws-bridge] command poll failed");
		// Retry slowly on error so we don't hammer a broken endpoint.
		return IDLE_POLL_FALLBACK_MS;
	}
}

function schedule(delayMs: number): void {
	if (pollTimer !== null) clearTimeout(pollTimer);
	pollTimer = setTimeout(async () => {
		const nextMs = await pollOnce();
		schedule(nextMs);
	}, delayMs);
}

/** Start the renderer-side bridge. Idempotent — second start is a no-op. */
export function startObsBridge(): void {
	if (pollTimer !== null) return;

	// Subscribe to relevant state slices; push the full snapshot on any
	// change rather than diff-tracking (the snapshot is tiny + JSON
	// comparison is fast).
	studio.select(
		(s) => ({
			activeSceneId: s.activeSceneId,
			scenesHash: s.scenes.map((sc) => `${sc.id}:${sc.name}`).join("|"),
			live: s.stream.live,
			recording: s.stream.recording,
		}),
		() => { void pushSnapshotIfChanged(); },
	);

	// Initial push so the mirror reflects state at boot.
	void pushSnapshotIfChanged();

	// Check whether the obs-ws server failed to start at boot. If
	// enabled=true but the server isn't listening, the user gets a
	// toast — otherwise the broken integration is silent until they
	// happen to open settings.
	void checkBootStatus();

	// Adaptive command polling. Starts at the idle cadence so we don't
	// pay the fast-poll cost before any client has connected; flips to
	// fast as soon as Bun reports clients.
	schedule(IDLE_POLL_FALLBACK_MS);
	logger().info("[obs-ws-bridge] started");
}

async function checkBootStatus(): Promise<void> {
	try {
		const cfg = await bunRpc.getObsWsConfig({});
		if (cfg.enabled && !cfg.listening) {
			// Lazy-import the toast helper so this module's main
			// surface stays close to RPC + dispatch — no UI primitive
			// at module load.
			const { toast } = await import("./components/overlays");
			const reason = cfg.lastStartupError ? `: ${cfg.lastStartupError}` : "";
			toast(`Stream Deck integration enabled but couldn't start${reason}. Open Settings → Stream Deck to fix.`, "error");
		}
	} catch (err) {
		logger().withError(err).warn("[obs-ws-bridge] boot status check failed");
	}
}

export function stopObsBridge(): void {
	if (pollTimer !== null) {
		clearTimeout(pollTimer);
		pollTimer = null;
	}
}
