// Tests for the deepened BroadcastCapture singleton — sink-attach /
// detach semantics. Uses the same FakeMediaRecorder pattern as
// capture.test.ts.

import { afterEach, describe, expect, test } from "bun:test";
import { broadcastCapture, type CaptureSink, type BroadcastStreamSource } from "./capture";

const originalMediaRecorder = globalThis.MediaRecorder;

let activeRecorder: FakeMediaRecorder | null = null;

class FakeMediaRecorder extends EventTarget {
	static isTypeSupported(): boolean { return true; }
	state: RecordingState = "inactive";
	constructor(_stream: MediaStream, _options: MediaRecorderOptions) {
		super();
		activeRecorder = this;
	}
	start(): void { this.state = "recording"; }
	requestData(): void {}
	stop(): void {
		this.state = "inactive";
		this.dispatchEvent(new Event("stop"));
	}
	emitData(): void {
		const event = new Event("dataavailable") as BlobEvent;
		Object.defineProperty(event, "data", { value: new Blob(["chunk"]) });
		this.dispatchEvent(event);
	}
}

function installFakeRecorder(): void {
	Object.defineProperty(globalThis, "MediaRecorder", {
		configurable: true,
		writable: true,
		value: FakeMediaRecorder,
	});
}

function makeSource(): BroadcastStreamSource {
	return {
		setResolution: () => {},
		setTargetFps: () => {},
		getOutputStream: () => new MediaStream(),
	};
}

afterEach(async () => {
	// Drain any leftover sinks so cross-test state doesn't leak.
	for (const id of broadcastCapture.attachedSinkIds) {
		await broadcastCapture.detach(id);
	}
	activeRecorder = null;
	if (originalMediaRecorder) {
		Object.defineProperty(globalThis, "MediaRecorder", { configurable: true, writable: true, value: originalMediaRecorder });
	} else {
		// happy-dom doesn't ship MediaRecorder. Restore the descriptor to
		// writable so presets.test.ts (which uses direct assignment) works.
		Object.defineProperty(globalThis, "MediaRecorder", { configurable: true, writable: true, value: undefined });
	}
});

describe("broadcastCapture sink API", () => {
	test("attach starts the recorder synchronously and fans chunks to the sink", async () => {
		installFakeRecorder();
		const chunks: Blob[] = [];
		const sink: CaptureSink = {
			id: "test-1",
			onChunk: (blob) => chunks.push(blob),
			onStop() {},
		};
		await broadcastCapture.attach(sink, { source: makeSource(), quality: "720p", chunkIntervalMs: 1000 });
		expect(broadcastCapture.isActive).toBe(true);
		expect(activeRecorder?.state).toBe("recording");
		activeRecorder?.emitData();
		expect(chunks).toHaveLength(1);
		await broadcastCapture.detach("test-1");
	});

	test("two sinks share one recorder; both receive each chunk", async () => {
		installFakeRecorder();
		const a: Blob[] = [];
		const b: Blob[] = [];
		await broadcastCapture.attach({ id: "a", onChunk: (b1) => a.push(b1), onStop() {} }, { source: makeSource(), quality: "720p", chunkIntervalMs: 1000 });
		await broadcastCapture.attach({ id: "b", onChunk: (b1) => b.push(b1), onStop() {} }, { source: makeSource(), quality: "720p", chunkIntervalMs: 1000 });
		const recorderAtAttach = activeRecorder;
		activeRecorder?.emitData();
		expect(a).toHaveLength(1);
		expect(b).toHaveLength(1);
		// Only ONE MediaRecorder was constructed for the second attach.
		expect(activeRecorder).toBe(recorderAtAttach);
	});

	test("detach of non-last sink keeps recorder running for the others", async () => {
		installFakeRecorder();
		const a: Blob[] = [];
		const b: Blob[] = [];
		await broadcastCapture.attach({ id: "a", onChunk: (x) => a.push(x), onStop() {} }, { source: makeSource(), quality: "720p", chunkIntervalMs: 1000 });
		await broadcastCapture.attach({ id: "b", onChunk: (x) => b.push(x), onStop() {} }, { source: makeSource(), quality: "720p", chunkIntervalMs: 1000 });
		await broadcastCapture.detach("a");
		expect(broadcastCapture.isActive).toBe(true);
		activeRecorder?.emitData();
		expect(a).toHaveLength(0); // a is gone
		expect(b).toHaveLength(1); // b still got it
	});

	test("detach of last sink stops the recorder and drains the final chunk to it", async () => {
		installFakeRecorder();
		const chunks: Blob[] = [];
		let stopCalled = false;
		await broadcastCapture.attach({
			id: "only",
			onChunk: (b) => chunks.push(b),
			onStop() { stopCalled = true; },
		}, { source: makeSource(), quality: "720p", chunkIntervalMs: 1000 });

		// Kick off detach (drains in background).
		const detachPromise = broadcastCapture.detach("only");
		// Simulate MediaRecorder's flush-on-stop.
		await new Promise((r) => setTimeout(r, 0));
		activeRecorder?.emitData();
		await detachPromise;

		expect(chunks).toHaveLength(1); // final chunk reached the sink before onStop
		expect(stopCalled).toBe(true);
		expect(broadcastCapture.isActive).toBe(false);
	});

	test("attach is rejected when the same sink id is already registered", async () => {
		installFakeRecorder();
		await broadcastCapture.attach({ id: "dup", onChunk: () => {}, onStop() {} }, { source: makeSource(), quality: "720p", chunkIntervalMs: 1000 });
		await expect(
			broadcastCapture.attach({ id: "dup", onChunk: () => {}, onStop() {} }, { source: makeSource(), quality: "720p", chunkIntervalMs: 1000 }),
		).rejects.toThrow(/already attached/);
		await broadcastCapture.detach("dup");
	});
});
