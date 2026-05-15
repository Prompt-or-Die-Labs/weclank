// Unit tests for the renderer-side obs-ws bridge's pure projection.
// The polling/IPC machinery is intentionally not unit-tested (it's a
// thin wrapper around bunRpc); the value is verifying that the
// snapshot shape is exactly what the Bun mirror expects.

import { describe, expect, test } from "bun:test";
import { buildObsMirrorSnapshot } from "./obs-ws-snapshot";
import type { Scene, StudioState } from "./core/types";
import type { SceneId, ParticipantId } from "./core/ids";

function fakeState(overrides: Partial<StudioState> = {}): StudioState {
	const sceneA: Scene = { id: "scene-a" as SceneId, name: "Scene A", sources: [] };
	const sceneB: Scene = { id: "scene-b" as SceneId, name: "Scene B", sources: [] };
	return {
		scenes: [sceneA, sceneB],
		activeSceneId: sceneA.id,
		participants: {},
		stream: {
			title: "Test broadcast",
			live: false,
			recording: false,
			quality: "720p",
		},
		runOfShow: { segments: [], activeSegmentId: null } as StudioState["runOfShow"],
		overlays: { titleCardActive: false } as StudioState["overlays"],
		streamOverlays: [],
		music: { volume: 0.7, current: null },
		focusedParticipantId: null,
		...overrides,
	};
}

describe("buildObsMirrorSnapshot", () => {
	test("translates scenes into sceneName + sceneIndex pairs", () => {
		const snap = buildObsMirrorSnapshot(fakeState());
		expect(snap.scenes).toEqual([
			{ sceneName: "Scene A", sceneIndex: 0 },
			{ sceneName: "Scene B", sceneIndex: 1 },
		]);
	});

	test("currentSceneName reflects activeSceneId", () => {
		const state = fakeState();
		expect(buildObsMirrorSnapshot(state).currentSceneName).toBe("Scene A");
		const withB = fakeState({ activeSceneId: state.scenes[1]!.id });
		expect(buildObsMirrorSnapshot(withB).currentSceneName).toBe("Scene B");
	});

	test("currentSceneName is null when activeSceneId doesn't match any scene", () => {
		const state = fakeState({ activeSceneId: "no-such-id" as SceneId });
		expect(buildObsMirrorSnapshot(state).currentSceneName).toBeNull();
	});

	test("streamLive reflects stream.live", () => {
		const state = fakeState({
			stream: { title: "", live: true, recording: false, quality: "720p" },
		});
		expect(buildObsMirrorSnapshot(state).streamLive).toBe(true);
	});

	test("recording reflects stream.recording", () => {
		const state = fakeState({
			stream: { title: "", live: false, recording: true, quality: "720p" },
		});
		expect(buildObsMirrorSnapshot(state).recording).toBe(true);
	});

	test("empty scenes list yields empty array + null current", () => {
		const state = fakeState({ scenes: [], activeSceneId: "x" as SceneId });
		const snap = buildObsMirrorSnapshot(state);
		expect(snap.scenes).toEqual([]);
		expect(snap.currentSceneName).toBeNull();
	});

	test("snapshot is JSON-stable (used for dedup in the bridge)", () => {
		// The bridge's `lastPushSnapshot = JSON.stringify(snap)` dedup
		// trick relies on the snapshot serialising stably. Verify the
		// same input produces byte-identical JSON.
		const a = JSON.stringify(buildObsMirrorSnapshot(fakeState()));
		const b = JSON.stringify(buildObsMirrorSnapshot(fakeState()));
		expect(a).toBe(b);
	});

	test("ParticipantId / SceneId branded types don't leak into the snapshot", () => {
		const snap = buildObsMirrorSnapshot(fakeState({
			focusedParticipantId: "p-1" as ParticipantId,
		}));
		// snap only carries scene names + booleans + sceneName/sceneIndex
		// pairs — no participant IDs, no scene IDs.
		expect("focusedParticipantId" in snap).toBe(false);
		expect(JSON.stringify(snap)).not.toContain("p-1");
	});
});
