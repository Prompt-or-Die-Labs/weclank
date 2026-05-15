import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	_resetObsBridgeForTesting,
	createBridgeStudioAdapter,
	drainObsCommands,
	enqueueObsCommand,
	readObsMirror,
	updateObsMirror,
} from "./studio-bridge";

beforeEach(() => _resetObsBridgeForTesting());
afterEach(() => _resetObsBridgeForTesting());

describe("ObsBridge — mirror state", () => {
	test("readObsMirror returns defaults when nothing has been pushed", () => {
		const m = readObsMirror();
		expect(m.scenes).toEqual([]);
		expect(m.currentSceneName).toBeNull();
		expect(m.streamLive).toBe(false);
		expect(m.recording).toBe(false);
	});

	test("updateObsMirror applies partial patches", () => {
		updateObsMirror({ streamLive: true });
		expect(readObsMirror().streamLive).toBe(true);
		// Other fields stay at defaults.
		expect(readObsMirror().currentSceneName).toBeNull();
	});

	test("scene list updates flow through to the mirror", () => {
		updateObsMirror({
			scenes: [
				{ sceneName: "A", sceneIndex: 0 },
				{ sceneName: "B", sceneIndex: 1 },
			],
			currentSceneName: "A",
		});
		const m = readObsMirror();
		expect(m.scenes).toHaveLength(2);
		expect(m.currentSceneName).toBe("A");
	});
});

describe("ObsBridge — command queue", () => {
	test("enqueue + drain is FIFO", () => {
		enqueueObsCommand({ type: "start-stream" });
		enqueueObsCommand({ type: "set-current-scene", sceneName: "Two" });
		const drained = drainObsCommands();
		expect(drained).toHaveLength(2);
		expect(drained[0]?.type).toBe("start-stream");
		expect(drained[1]?.type).toBe("set-current-scene");
	});

	test("drainObsCommands empties the queue", () => {
		enqueueObsCommand({ type: "stop-stream" });
		drainObsCommands();
		expect(drainObsCommands()).toEqual([]);
	});
});

describe("BridgeStudioAdapter — reads hit the mirror", () => {
	test("getScenes / getCurrentSceneName / isStreamLive / isRecording", () => {
		updateObsMirror({
			scenes: [{ sceneName: "Main", sceneIndex: 0 }],
			currentSceneName: "Main",
			streamLive: true,
			recording: true,
		});
		const a = createBridgeStudioAdapter();
		expect(a.getScenes()).toHaveLength(1);
		expect(a.getCurrentSceneName()).toBe("Main");
		expect(a.isStreamLive()).toBe(true);
		expect(a.isRecording()).toBe(true);
	});

	test("getStreamTimecode / getRecordTimecode default to zero-string", () => {
		const a = createBridgeStudioAdapter();
		expect(a.getStreamTimecode()).toBe("00:00:00.000");
		expect(a.getRecordTimecode()).toBe("00:00:00.000");
	});
});

describe("BridgeStudioAdapter — writes enqueue commands", () => {
	test("setCurrentSceneName enqueues set-current-scene and validates against mirror", () => {
		updateObsMirror({ scenes: [{ sceneName: "Main", sceneIndex: 0 }] });
		const a = createBridgeStudioAdapter();
		const ok = a.setCurrentSceneName("Main");
		expect(ok).toBe(true);
		const drained = drainObsCommands();
		expect(drained[0]).toEqual({ type: "set-current-scene", sceneName: "Main" });
	});

	test("setCurrentSceneName returns false when scene is unknown but still enqueues", () => {
		updateObsMirror({ scenes: [{ sceneName: "Main", sceneIndex: 0 }] });
		const a = createBridgeStudioAdapter();
		const ok = a.setCurrentSceneName("Unknown");
		expect(ok).toBe(false);
		// Still queued — the renderer is the authoritative validator.
		expect(drainObsCommands()).toHaveLength(1);
	});

	test("startStream / stopStream / startRecord / stopRecord enqueue corresponding commands", async () => {
		const a = createBridgeStudioAdapter();
		await a.startStream();
		await a.stopStream();
		await a.startRecord();
		await a.stopRecord();
		const drained = drainObsCommands();
		expect(drained.map((c) => c.type)).toEqual([
			"start-stream",
			"stop-stream",
			"start-record",
			"stop-record",
		]);
	});
});
