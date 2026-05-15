import { afterEach, describe, expect, test } from "bun:test";
import { broadcastCapture, type BroadcastStreamSource, type CaptureSink } from "./capture";

let activeRecorder: FakeMediaRecorder | null = null;
let requestDataCalls = 0;

class FakeMediaRecorder extends EventTarget {
	static isTypeSupported(): boolean {
		return true;
	}

	state: RecordingState = "inactive";
	ondataavailable: ((event: BlobEvent) => void) | null = null;
	onerror: ((event: Event) => void) | null = null;

	constructor(_stream: MediaStream, _options: MediaRecorderOptions) {
		super();
		activeRecorder = this;
	}

	start(): void {
		this.state = "recording";
	}

	requestData(): void {
		requestDataCalls += 1;
	}

	stop(): void {
		this.state = "inactive";
		this.dispatchEvent(new Event("stop"));
	}

	emitData(): void {
		const event = new Event("dataavailable") as BlobEvent;
		Object.defineProperty(event, "data", { value: new Blob(["final"]) });
		this.dispatchEvent(event);
	}
}

const originalMediaRecorder = globalThis.MediaRecorder;

afterEach(async () => {
	for (const id of broadcastCapture.attachedSinkIds) {
		await broadcastCapture.detach(id);
	}
	activeRecorder = null;
	requestDataCalls = 0;
	if (originalMediaRecorder) {
		Object.defineProperty(globalThis, "MediaRecorder", {
			configurable: true,
			writable: true,
			value: originalMediaRecorder,
		});
	} else {
		Object.defineProperty(globalThis, "MediaRecorder", {
			configurable: true,
			writable: true,
			value: undefined,
		});
	}
});

function makeSink(opts: { id: string; onChunk?: (b: Blob) => void } = { id: "test" }): CaptureSink {
	return {
		id: opts.id,
		onChunk: opts.onChunk ?? (() => {}),
		onStop() {},
	};
}

describe("broadcastCapture lifecycle", () => {
	test("detach waits for the final dataavailable event before resolving", async () => {
		Object.defineProperty(globalThis, "MediaRecorder", {
			configurable: true,
			writable: true,
			value: FakeMediaRecorder,
		});
		const chunks: Blob[] = [];
		const calls: Array<[number, number]> = [];
		const source: BroadcastStreamSource = {
			setResolution: (width, height) => calls.push([width, height]),
			setTargetFps: () => {},
			getOutputStream: () => new MediaStream(),
		};

		await broadcastCapture.attach(makeSink({ id: "drain", onChunk: (b) => chunks.push(b) }), {
			source,
			quality: "720p",
			chunkIntervalMs: 5_000,
		});
		const recorder = activeRecorder;
		if (!recorder) throw new Error("Fake recorder did not initialize");

		let detached = false;
		const detachPromise = broadcastCapture.detach("drain").then(() => {
			detached = true;
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(detached).toBe(false);
		expect(chunks).toHaveLength(0);

		recorder.emitData();
		await detachPromise;

		expect(detached).toBe(true);
		expect(chunks).toHaveLength(1);
		expect(calls).toContainEqual([1280, 720]);
	});

	test("periodic flush calls requestData while recording and stops after detach", async () => {
		Object.defineProperty(globalThis, "MediaRecorder", {
			configurable: true,
			writable: true,
			value: FakeMediaRecorder,
		});
		const source: BroadcastStreamSource = {
			setResolution: () => {},
			setTargetFps: () => {},
			getOutputStream: () => new MediaStream(),
		};

		await broadcastCapture.attach(makeSink({ id: "flush" }), {
			source,
			quality: "480p",
			chunkIntervalMs: 10,
		});
		await new Promise((resolve) => setTimeout(resolve, 35));

		expect(requestDataCalls).toBeGreaterThanOrEqual(2);

		const detachPromise = broadcastCapture.detach("flush");
		activeRecorder?.emitData();
		await detachPromise;
		const callsAfterStop = requestDataCalls;
		await new Promise((resolve) => setTimeout(resolve, 25));

		expect(requestDataCalls).toBe(callsAfterStop);
	});
});
