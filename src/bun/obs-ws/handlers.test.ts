import { describe, expect, test } from "bun:test";
import { HANDLERS, type StudioAdapter } from "./handlers";

function fakeAdapter(overrides: Partial<StudioAdapter> = {}): StudioAdapter {
	return {
		getScenes: () => [
			{ sceneName: "Scene 1", sceneIndex: 0 },
			{ sceneName: "Scene 2", sceneIndex: 1 },
		],
		getCurrentSceneName: () => "Scene 1",
		setCurrentSceneName: () => true,
		isStreamLive: () => false,
		isRecording: () => false,
		startStream: async () => true,
		stopStream: async () => true,
		startRecord: async () => true,
		stopRecord: async () => true,
		getRecordTimecode: () => "00:00:00.000",
		getStreamTimecode: () => "00:00:00.000",
		...overrides,
	};
}

describe("obs-websocket handlers — scene", () => {
	test("GetVersion reports rpcVersion=1 and availableRequests list", async () => {
		const r = await HANDLERS["GetVersion"]!({}, fakeAdapter());
		expect(r.ok).toBe(true);
		expect(r.data?.["rpcVersion"]).toBe(1);
		expect(Array.isArray(r.data?.["availableRequests"])).toBe(true);
		expect((r.data?.["availableRequests"] as string[]).length).toBeGreaterThan(0);
	});

	test("GetSceneList returns scenes + current", async () => {
		const r = await HANDLERS["GetSceneList"]!({}, fakeAdapter());
		expect(r.ok).toBe(true);
		expect(r.data?.["currentProgramSceneName"]).toBe("Scene 1");
		const scenes = r.data?.["scenes"] as Array<{ sceneName: string }>;
		expect(scenes).toHaveLength(2);
	});

	test("GetCurrentProgramScene returns the active scene name", async () => {
		const r = await HANDLERS["GetCurrentProgramScene"]!({}, fakeAdapter());
		expect(r.ok).toBe(true);
		expect(r.data?.["sceneName"]).toBe("Scene 1");
	});

	test("GetCurrentProgramScene fails when no scene active", async () => {
		const r = await HANDLERS["GetCurrentProgramScene"]!(
			{},
			fakeAdapter({ getCurrentSceneName: () => null }),
		);
		expect(r.ok).toBe(false);
	});

	test("SetCurrentProgramScene routes to adapter", async () => {
		let lastName: string | undefined;
		const r = await HANDLERS["SetCurrentProgramScene"]!(
			{ sceneName: "Scene 2" },
			fakeAdapter({
				setCurrentSceneName: (n) => {
					lastName = n;
					return true;
				},
			}),
		);
		expect(r.ok).toBe(true);
		expect(lastName).toBe("Scene 2");
	});

	test("SetCurrentProgramScene fails on missing sceneName", async () => {
		const r = await HANDLERS["SetCurrentProgramScene"]!({}, fakeAdapter());
		expect(r.ok).toBe(false);
	});

	test("SetCurrentProgramScene fails on unknown scene", async () => {
		const r = await HANDLERS["SetCurrentProgramScene"]!(
			{ sceneName: "no-such" },
			fakeAdapter({ setCurrentSceneName: () => false }),
		);
		expect(r.ok).toBe(false);
		expect(r.comment).toContain("no-such");
	});
});

describe("obs-websocket handlers — stream + record", () => {
	test("GetStreamStatus reports outputActive based on isStreamLive", async () => {
		const r = await HANDLERS["GetStreamStatus"]!(
			{},
			fakeAdapter({ isStreamLive: () => true }),
		);
		expect(r.data?.["outputActive"]).toBe(true);
	});

	test("StartStream / StopStream call through", async () => {
		let started = false, stopped = false;
		const adapter = fakeAdapter({
			startStream: async () => { started = true; return true; },
			stopStream: async () => { stopped = true; return true; },
		});
		await HANDLERS["StartStream"]!({}, adapter);
		await HANDLERS["StopStream"]!({}, adapter);
		expect(started).toBe(true);
		expect(stopped).toBe(true);
	});

	test("ToggleStream calls stop when live, start otherwise", async () => {
		let stopCalls = 0, startCalls = 0;
		const live = fakeAdapter({
			isStreamLive: () => true,
			stopStream: async () => { stopCalls++; return true; },
			startStream: async () => { startCalls++; return true; },
		});
		await HANDLERS["ToggleStream"]!({}, live);
		expect(stopCalls).toBe(1);
		expect(startCalls).toBe(0);

		const offline = fakeAdapter({
			isStreamLive: () => false,
			stopStream: async () => { stopCalls++; return true; },
			startStream: async () => { startCalls++; return true; },
		});
		await HANDLERS["ToggleStream"]!({}, offline);
		expect(startCalls).toBe(1);
	});

	test("GetRecordStatus reports outputActive based on isRecording", async () => {
		const r = await HANDLERS["GetRecordStatus"]!(
			{},
			fakeAdapter({ isRecording: () => true }),
		);
		expect(r.data?.["outputActive"]).toBe(true);
	});

	test("BroadcastCustomEvent accepts an event object", () => {
		const r = HANDLERS["BroadcastCustomEvent"]!(
			{ eventData: { custom: "yes" } },
			fakeAdapter(),
		);
		expect((r as { ok: boolean }).ok).toBe(true);
	});

	test("BroadcastCustomEvent rejects missing eventData", () => {
		const r = HANDLERS["BroadcastCustomEvent"]!({}, fakeAdapter());
		expect((r as { ok: boolean }).ok).toBe(false);
	});
});
