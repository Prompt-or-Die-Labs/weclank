// Zero-dep pure projection from studio state → obs-ws mirror shape.
//
// Lives in its own file so unit tests can import without dragging
// in the renderer-side bridge's transitive deps (streamEngine,
// localRecorder, etc. — all of which need a real Canvas/Media-
// Recorder runtime that happy-dom doesn't fully provide).

import type { StudioState } from "./core/types";

export interface ObsMirrorSnapshot {
	scenes: Array<{ sceneName: string; sceneIndex: number }>;
	currentSceneName: string | null;
	streamLive: boolean;
	recording: boolean;
}

/** Pure projection from studio state to the obs-ws mirror shape. */
export function buildObsMirrorSnapshot(state: StudioState): ObsMirrorSnapshot {
	const scenes = state.scenes.map((sc, i) => ({ sceneName: sc.name, sceneIndex: i }));
	const active = state.scenes.find((sc) => sc.id === state.activeSceneId);
	return {
		scenes,
		currentSceneName: active?.name ?? null,
		streamLive: state.stream.live,
		recording: state.stream.recording,
	};
}
