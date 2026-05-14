import { afterEach, describe, expect, test } from "bun:test";
import { startBroadcastCapture, type BroadcastStreamSource } from "./capture";

let activeRecorder: FakeMediaRecorder | null = null;

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

	requestData(): void {}

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

afterEach(() => {
	activeRecorder = null;
	if (originalMediaRecorder) {
		Object.defineProperty(globalThis, "MediaRecorder", {
			configurable: true,
			value: originalMediaRecorder,
		});
	} else {
		delete (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
	}
});

describe("startBroadcastCapture", () => {
	test("waits for the final dataavailable event before stop resolves", async () => {
		Object.defineProperty(globalThis, "MediaRecorder", {
			configurable: true,
			value: FakeMediaRecorder,
		});
		const chunks: Blob[] = [];
		const calls: Array<[number, number]> = [];
		const source: BroadcastStreamSource = {
			setResolution: (width, height) => calls.push([width, height]),
			setTargetFps: () => {},
			getOutputStream: () => new MediaStream(),
		};

		const session = startBroadcastCapture({
			source,
			quality: "720p",
			chunkIntervalMs: 5_000,
			onChunk: (blob) => chunks.push(blob),
			onError: () => {},
		});
		const recorder = activeRecorder;
		if (!recorder) throw new Error("Fake recorder did not initialize");

		let stopped = false;
		const stopPromise = session.stop().then(() => {
			stopped = true;
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(stopped).toBe(false);
		expect(chunks).toHaveLength(0);

		recorder.emitData();
		await stopPromise;

		expect(stopped).toBe(true);
		expect(chunks).toHaveLength(1);
		expect(calls).toContainEqual([1280, 720]);
	});
});
