// Bun-side bridge between obs-websocket and the renderer's studio
// state. obs-ws runs in Bun (where the network socket lives); studio
// state lives in the renderer (where it's used).
//
// Two channels keep them in sync:
//
//   - **Mirror (renderer → Bun)**: The renderer's studio-store
//     subscribes to its own state and pushes a flat snapshot to
//     `updateObsMirror` whenever the relevant slice changes. The
//     mirror is read synchronously by the StudioAdapter when an
//     obs-ws client asks for scene/stream/recording state.
//
//   - **Commands (Bun → renderer)**: When a Stream Deck button maps
//     to a "set current scene" or "start streaming" request, the
//     StudioAdapter doesn't mutate state itself — it enqueues a
//     command, which the renderer polls via `pollObsCommands` and
//     executes against its own studio-store. Polling beats push
//     because the renderer drives its own lifecycle.

import type { SceneSummary, StudioAdapter } from "./handlers";

export interface ObsMirror {
	scenes: SceneSummary[];
	currentSceneName: string | null;
	streamLive: boolean;
	recording: boolean;
	streamTimecode: string;
	recordTimecode: string;
}

export type ObsCommand =
	| { type: "set-current-scene"; sceneName: string }
	| { type: "start-stream" }
	| { type: "stop-stream" }
	| { type: "start-record" }
	| { type: "stop-record" };

const initialMirror: ObsMirror = {
	scenes: [],
	currentSceneName: null,
	streamLive: false,
	recording: false,
	streamTimecode: "00:00:00.000",
	recordTimecode: "00:00:00.000",
};

let mirror: ObsMirror = { ...initialMirror };
const commandQueue: ObsCommand[] = [];

export function updateObsMirror(next: Partial<ObsMirror>): void {
	mirror = { ...mirror, ...next };
}

export function readObsMirror(): ObsMirror {
	return { ...mirror };
}

export function enqueueObsCommand(command: ObsCommand): void {
	commandQueue.push(command);
}

export function drainObsCommands(): ObsCommand[] {
	const drained = commandQueue.splice(0, commandQueue.length);
	return drained;
}

/** Construct the StudioAdapter the obs-ws server hands to its
 *  handlers. Queries hit the mirror; actions enqueue commands. */
export function createBridgeStudioAdapter(): StudioAdapter {
	return {
		getScenes: () => readObsMirror().scenes,
		getCurrentSceneName: () => readObsMirror().currentSceneName,
		setCurrentSceneName: (name) => {
			// Always enqueue. The mirror won't show the change until
			// the renderer applies it and pushes the next update —
			// that's correct: the obs-ws client gets the *committed*
			// state, not an optimistic guess.
			enqueueObsCommand({ type: "set-current-scene", sceneName: name });
			// Return true if the scene exists; the renderer will
			// validate again on its side.
			return readObsMirror().scenes.some((s) => s.sceneName === name);
		},
		isStreamLive: () => readObsMirror().streamLive,
		isRecording: () => readObsMirror().recording,
		startStream: async () => {
			enqueueObsCommand({ type: "start-stream" });
			return true;
		},
		stopStream: async () => {
			enqueueObsCommand({ type: "stop-stream" });
			return true;
		},
		startRecord: async () => {
			enqueueObsCommand({ type: "start-record" });
			return true;
		},
		stopRecord: async () => {
			enqueueObsCommand({ type: "stop-record" });
			return true;
		},
		getRecordTimecode: () => readObsMirror().recordTimecode,
		getStreamTimecode: () => readObsMirror().streamTimecode,
	};
}

/** Test-only reset. */
export function _resetObsBridgeForTesting(): void {
	mirror = { ...initialMirror };
	commandQueue.length = 0;
}
