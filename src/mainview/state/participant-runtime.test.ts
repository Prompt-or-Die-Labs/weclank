// Test the participant runtime through its public interface: attach
// records what's there, dispose tears it down in the right order. We
// mock the actual subsystems (banter, voice route, mixer, renderer-farm)
// because the interface contract is "dispose calls those in this order",
// not "the underlying subsystems work."

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

type EventName = "banter-stop" | "voice-dispose" | "mixer-remove" | "track-stop" | "blob-revoke" | "renderer-dispose";
let events: EventName[] = [];

mock.module("../streaming/audio-mixer", () => {
	const ctx = new AudioContext();
	return {
		audioMixer: {
			ctx,
			removeInput: () => { events.push("mixer-remove"); },
			addInput: () => null,
			getAnalyser: () => undefined,
			hasChannel: () => false,
			resume: async () => {},
		},
	};
});
mock.module("../banter/banter-engine", () => ({
	banterEngine: { stop: () => { events.push("banter-stop"); } },
}));
// Stub the full registry surface — bun's `mock.module` mutates the
// module process-wide and there is no restore for module mocks, so a
// later test that imports a different named export from `tts/registry`
// would hit a "Export not found" error at link time without this.
mock.module("../tts/registry", () => ({
	disposeVoiceRoute: () => { events.push("voice-dispose"); },
	initVoiceRoute: () => ({ provider: null, stream: new MediaStream() }),
	createTTSProvider: () => null,
	disposeTTSProvider: () => {},
	ensureVoiceRoute: () => null,
	getTTSProvider: () => undefined,
	getStoredApiKey: () => "",
	setStoredApiKey: async () => {},
	speakWithVoiceRoute: async () => {},
}));
mock.module("../components/renderer-farm", () => ({
	rendererFarm: { dispose: () => { events.push("renderer-dispose"); } },
}));

const originalRevoke = globalThis.URL?.revokeObjectURL;
beforeEach(() => {
	events = [];
	(globalThis.URL as unknown as { revokeObjectURL: (s: string) => void }).revokeObjectURL = () => {
		events.push("blob-revoke");
	};
});
afterEach(() => {
	if (originalRevoke) (globalThis.URL as unknown as { revokeObjectURL: typeof originalRevoke }).revokeObjectURL = originalRevoke;
});

const { participantRuntime } = await import("./participant-runtime");
const { participantId } = await import("../core/ids");

function fakeMediaStream(): MediaStream {
	return {
		getTracks: () => [{
			stop: () => { events.push("track-stop"); },
		}],
	} as unknown as MediaStream;
}

afterEach(() => {
	participantRuntime._resetForTesting();
});

describe("participantRuntime", () => {
	test("attach records what's there; peek shows it", () => {
		const id = participantId("p-test1");
		participantRuntime.attach(id, { hasVoiceRoute: true, hasBanterSession: true, hasRenderer: true });
		const record = participantRuntime.peek(id);
		expect(record?.hasVoiceRoute).toBe(true);
		expect(record?.hasBanterSession).toBe(true);
		expect(record?.hasRenderer).toBe(true);
		expect(record?.hasMixerInput).toBe(false);
	});

	test("dispose runs the agent teardown in order: banter → voice → renderer", async () => {
		const id = participantId("p-agent1");
		participantRuntime.attach(id, { hasVoiceRoute: true, hasBanterSession: true, hasRenderer: true });
		await participantRuntime.dispose(id);
		expect(events).toEqual(["banter-stop", "voice-dispose", "renderer-dispose"]);
	});

	test("dispose runs the human teardown: mixer + media tracks + renderer", async () => {
		const id = participantId("p-human1");
		participantRuntime.attach(id, {
			mediaStream: fakeMediaStream(),
			hasMixerInput: true,
			hasRenderer: true,
		});
		await participantRuntime.dispose(id);
		expect(events).toEqual(["mixer-remove", "track-stop", "renderer-dispose"]);
	});

	test("dispose revokes blob model URLs", async () => {
		const id = participantId("p-vrm1");
		participantRuntime.attach(id, {
			blobModelUrl: "blob:weclank/vrm-123",
			hasVoiceRoute: true,
			hasBanterSession: true,
			hasRenderer: true,
		});
		await participantRuntime.dispose(id);
		expect(events).toContain("blob-revoke");
		// blob-revoke happens after tracks but before renderer.
		expect(events.indexOf("blob-revoke")).toBeLessThan(events.indexOf("renderer-dispose"));
	});

	test("dispose is a no-op when nothing was attached", async () => {
		const id = participantId("p-empty");
		await participantRuntime.dispose(id);
		expect(events).toEqual([]);
	});

	test("dispose only runs once per attach", async () => {
		const id = participantId("p-once");
		participantRuntime.attach(id, { hasBanterSession: true });
		await participantRuntime.dispose(id);
		events = [];
		await participantRuntime.dispose(id);
		expect(events).toEqual([]);
	});

	test("text-only assistant: only banter is stopped", async () => {
		const id = participantId("p-text1");
		participantRuntime.attach(id, { hasBanterSession: true });
		await participantRuntime.dispose(id);
		expect(events).toEqual(["banter-stop"]);
	});

	test("voice route and mixer input are mutually exclusive — voice route wins", async () => {
		const id = participantId("p-conflict");
		participantRuntime.attach(id, { hasVoiceRoute: true, hasMixerInput: true });
		await participantRuntime.dispose(id);
		// Only voice-dispose runs; the direct mixer removeInput would
		// double-remove the same input.
		expect(events).toEqual(["voice-dispose"]);
	});
});
