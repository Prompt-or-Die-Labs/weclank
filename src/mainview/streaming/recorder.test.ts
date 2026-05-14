import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

let startCalls = 0;
let finishCalls = 0;
let cancelCalls = 0;
let startResult: { success: boolean; path?: string; reason?: string; error?: string };
let finishResult: { success: boolean; path?: string; reason?: string; error?: string };
let lastChunkInterval = 0;
const events: string[] = [];
const originalMediaRecorder = globalThis.MediaRecorder;

class DelayedFinalMediaRecorder extends EventTarget {
	static isTypeSupported(): boolean {
		return true;
	}

	state: RecordingState = "inactive";
	ondataavailable: ((event: BlobEvent) => void) | null = null;
	onerror: ((event: Event) => void) | null = null;

	constructor(_stream: MediaStream, _options: MediaRecorderOptions) {
		super();
	}

	start(interval?: number): void {
		lastChunkInterval = interval ?? 0;
		this.state = "recording";
	}

	requestData(): void {}

	stop(): void {
		this.state = "inactive";
		this.dispatchEvent(new Event("stop"));
		setTimeout(() => this.emitData(), 600);
	}

	private emitData(): void {
		const event = new Event("dataavailable") as BlobEvent;
		Object.defineProperty(event, "data", { value: new Blob(["final"]) });
		this.ondataavailable?.(event);
		this.dispatchEvent(event);
	}
}

async function waitFor(predicate: () => boolean): Promise<void> {
	const started = Date.now();
	while (!predicate()) {
		if (Date.now() - started > 2_500) throw new Error("Timed out waiting for recorder test condition");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

beforeAll(() => {
	mock.module("../rpc", () => ({
		bunRpc: {
			startRecordingFile: async () => {
				startCalls += 1;
				return startResult;
			},
			cancelRecordingFile: async () => {
				cancelCalls += 1;
				return {};
			},
			writeRecordingChunk: async () => {
				events.push("write");
				return { ok: true };
			},
			finishRecordingFile: async () => {
				finishCalls += 1;
				events.push("finish");
				return finishResult;
			},
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

beforeEach(() => {
	startCalls = 0;
	finishCalls = 0;
	cancelCalls = 0;
	lastChunkInterval = 0;
	events.length = 0;
	startResult = { success: false, reason: "canceled" };
	finishResult = { success: false, reason: "canceled" };
});

afterEach(() => {
	if (originalMediaRecorder) {
		Object.defineProperty(globalThis, "MediaRecorder", {
			configurable: true,
			value: originalMediaRecorder,
		});
	} else {
		delete (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
	}
});

describe("localRecorder", () => {
	test("reports a canceled picker without entering recording state", async () => {
		const { localRecorder } = await import("./recorder");

		const started = await localRecorder.start();

		expect(started).toBe(false);
		expect(startCalls).toBe(1);
		expect(localRecorder.isRecording).toBe(false);
	});

	test("writes the final chunk before finishing the recording file", async () => {
		Object.defineProperty(globalThis, "MediaRecorder", {
			configurable: true,
			value: DelayedFinalMediaRecorder,
		});
		startResult = { success: true, path: "/tmp/weclank.mp4" };
		const { localRecorder } = await import("./recorder");

		const started = await localRecorder.start();
		localRecorder.stop();
		await waitFor(() => finishCalls === 1);

		expect(started).toBe(true);
		expect(lastChunkInterval).toBe(1_000);
		expect(finishCalls).toBe(1);
		expect(events.indexOf("write")).toBeGreaterThanOrEqual(0);
		expect(events.indexOf("write")).toBeLessThan(events.indexOf("finish"));
		expect(cancelCalls).toBe(0);
		expect(localRecorder.isRecording).toBe(false);
	});
});
