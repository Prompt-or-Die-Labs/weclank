import { beforeAll, describe, expect, mock, test } from "bun:test";

let startCalls = 0;

beforeAll(() => {
	mock.module("../rpc", () => ({
		bunRpc: {
			startRecordingFile: async () => {
				startCalls += 1;
				return { success: false, reason: "canceled" };
			},
			cancelRecordingFile: async () => ({}),
			writeRecordingChunk: async () => ({ ok: true }),
			finishRecordingFile: async () => ({ success: false, reason: "canceled" }),
		},
	}));
	mock.module("./stream-engine", () => ({
		streamEngine: {
			setResolution: () => {},
			setTargetFps: () => {},
			getOutputStream: () => new MediaStream(),
		},
	}));
});

describe("localRecorder", () => {
	test("reports a canceled picker without entering recording state", async () => {
		const { localRecorder } = await import("./recorder");

		const started = await localRecorder.start();

		expect(started).toBe(false);
		expect(startCalls).toBe(1);
		expect(localRecorder.isRecording).toBe(false);
	});
});
