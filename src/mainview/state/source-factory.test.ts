import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Participant } from "../core/types";

let pickedKinds: MediaDeviceKind[] = [];
let lastUserMediaConstraints: MediaStreamConstraints | undefined;
let lastDisplayMediaConstraints: DisplayMediaStreamOptions | undefined;
let cameraStream: MediaStream;
let screenStream: MediaStream;
let rendererParticipants: Participant[] = [];

const pickedVideoDevice: MediaDeviceInfo = {
	deviceId: "iphone-continuity",
	groupId: "continuity",
	kind: "videoinput",
	label: "Casey's iPhone Camera",
	toJSON: () => ({}),
};

beforeAll(() => {
	mock.module("./device-picker", () => ({
		pickInputDevice: async (kind: MediaDeviceKind) => {
			pickedKinds.push(kind);
			return kind === "videoinput" ? pickedVideoDevice : null;
		},
	}));
	mock.module("../components/renderer-farm", () => ({
		rendererFarm: {
			ensureRenderer: async (participant: Participant) => {
				rendererParticipants.push(participant);
			},
			dispose: () => {},
		},
	}));
	mock.module("../streaming/audio-mixer", () => ({
		audioMixer: { removeInput: () => {} },
	}));
	mock.module("../tts/config-dialog", () => ({
		pickTTSConfig: async () => null,
	}));
	mock.module("../tts/voice-route", () => ({
		disposeVoiceRoute: () => {},
		initVoiceRoute: () => ({ stream: new MediaStream() }),
	}));
	mock.module("../banter/assistant-config-dialog", () => ({
		pickAssistantConfig: async () => null,
	}));
	mock.module("../banter/banter-engine", () => ({
		banterEngine: {
			start: () => ({ ok: true }),
			stop: () => {},
			isRunning: () => false,
			sessionCount: () => 0,
			getPhase: () => "idle",
			getToolCallLog: () => [],
			injectFor: () => {},
			subscribeReplies: () => () => {},
			onSessionLifecycle: () => () => {},
		},
	}));
	mock.module("../rpc", () => ({
		bunRpc: {
			pickImageFileForVoiceParticipant: async () => ({ canceled: true }),
			pickModelFile: async () => ({ canceled: true }),
		},
	}));
});

beforeEach(async () => {
	pickedKinds = [];
	lastUserMediaConstraints = undefined;
	lastDisplayMediaConstraints = undefined;
	cameraStream = new MediaStream();
	screenStream = new MediaStream();
	rendererParticipants = [];
	const mediaDevices = {
		getUserMedia: async (constraints?: MediaStreamConstraints) => {
			lastUserMediaConstraints = constraints;
			return cameraStream;
		},
		getDisplayMedia: async (constraints?: DisplayMediaStreamOptions) => {
			lastDisplayMediaConstraints = constraints;
			return screenStream;
		},
	};
	Object.defineProperty(navigator, "mediaDevices", {
		configurable: true,
		value: mediaDevices,
	});
	const { studio } = await import("./studio-store");
	studio.installRestored({});
});

describe("createParticipantFromKind", () => {
	test("starts the picked camera source when requested by the recorder flow", async () => {
		const { createParticipantFromKind } = await import("./source-factory");
		const { studio } = await import("./studio-store");

		const id = await createParticipantFromKind("camera", { startVideo: true });
		if (!id) throw new Error("expected a camera participant");
		const participant = studio.state.participants[id];

		expect(pickedKinds).toEqual(["videoinput"]);
		expect(lastUserMediaConstraints).toEqual({
			video: { deviceId: { exact: "iphone-continuity" } },
			audio: false,
		});
		expect(participant?.displayName).toBe("Casey's iPhone Camera");
		expect(participant?.cameraOff).toBe(false);
		expect(participant?.mediaStream).toBe(cameraStream);
		expect(studio.activeScene.sources.some((source) => source.participantId === id)).toBe(true);
		expect(rendererParticipants.at(-1)?.mediaStream).toBe(cameraStream);
	});

	test("captures screen media before adding the source to the scene", async () => {
		const { createParticipantFromKind } = await import("./source-factory");
		const { studio } = await import("./studio-store");

		const id = await createParticipantFromKind("screen", { startVideo: true });
		if (!id) throw new Error("expected a screen participant");
		const participant = studio.state.participants[id];

		expect(lastDisplayMediaConstraints).toEqual({ video: true, audio: false });
		expect(participant?.kind).toBe("screen");
		expect(participant?.mediaStream).toBe(screenStream);
		expect(studio.activeScene.sources.some((source) => source.participantId === id)).toBe(true);
		expect(rendererParticipants.at(-1)?.mediaStream).toBe(screenStream);
	});
});
