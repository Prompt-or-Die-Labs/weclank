import { describe, expect, test } from "bun:test";
import type { CaptureMeta } from "./capture";
import { ReplayBuffer } from "./replay-buffer";

const META: CaptureMeta = {
	mimeType: "video/webm",
	quality: "720p",
	chunkIntervalMs: 1_000,
};

function fakeChunk(bytes: number): Blob {
	return new Blob([new Uint8Array(bytes)], { type: "video/webm" });
}

describe("ReplayBuffer (sink behavior)", () => {
	test("buffers chunks up to the window seconds", () => {
		const rb = new ReplayBuffer({ windowSeconds: 5 });
		rb.onStart(META);
		// 5s window @ 1s chunks = 5 max chunks. Push 8 chunks, expect ring to cap at 5.
		for (let i = 0; i < 8; i++) rb.onChunk(fakeChunk(100));
		expect(rb.bufferedChunks).toBe(5);
		expect(rb.bufferedSeconds).toBe(5);
		expect(rb.bufferedBytes).toBe(500);
	});

	test("drops oldest chunks beyond the window (FIFO)", () => {
		// Window clamped at the 5s floor; push 6 chunks of size 1,2,...,6
		// to verify chunk(1) gets evicted.
		const rb = new ReplayBuffer({ windowSeconds: 5 });
		rb.onStart(META);
		for (let i = 1; i <= 6; i++) rb.onChunk(fakeChunk(i));
		const snap = rb.snapshot();
		// Surviving chunks: 2 + 3 + 4 + 5 + 6 = 20
		expect(snap?.blob.size).toBe(20);
	});

	test("snapshot() returns null when buffer is empty", () => {
		const rb = new ReplayBuffer();
		// Haven't onStart()'d yet — no mimeType.
		expect(rb.snapshot()).toBeNull();
	});

	test("snapshot() returns null after onStart but no chunks", () => {
		const rb = new ReplayBuffer();
		rb.onStart(META);
		expect(rb.snapshot()).toBeNull();
	});

	test("onStop() clears the buffer", () => {
		const rb = new ReplayBuffer();
		rb.onStart(META);
		rb.onChunk(fakeChunk(100));
		rb.onChunk(fakeChunk(100));
		expect(rb.bufferedChunks).toBe(2);
		rb.onStop();
		expect(rb.bufferedChunks).toBe(0);
		expect(rb.snapshot()).toBeNull();
	});

	test("onStart() resets the buffer (re-attach scenario)", () => {
		const rb = new ReplayBuffer();
		rb.onStart(META);
		rb.onChunk(fakeChunk(100));
		// Imagine a stop happens, then a fresh start.
		rb.onStart(META);
		expect(rb.bufferedChunks).toBe(0);
	});

	test("respects 5s minimum window", () => {
		// Even if caller asks for a tiny window, we clamp to 5s.
		const rb = new ReplayBuffer({ windowSeconds: 0 });
		rb.onStart(META);
		for (let i = 0; i < 10; i++) rb.onChunk(fakeChunk(1));
		expect(rb.bufferedChunks).toBe(5); // 5s @ 1s chunks
	});

	test("snapshot blob has the correct mime type", () => {
		const meta: CaptureMeta = { ...META, mimeType: "video/webm;codecs=vp8,opus" };
		const rb = new ReplayBuffer();
		rb.onStart(meta);
		rb.onChunk(fakeChunk(100));
		const snap = rb.snapshot();
		expect(snap?.mimeType).toBe("video/webm;codecs=vp8,opus");
		expect(snap?.blob.type).toBe("video/webm;codecs=vp8,opus");
	});

	test("calculates bufferedSeconds from chunkIntervalMs", () => {
		const rb = new ReplayBuffer({ windowSeconds: 30 });
		// Different chunk cadence — 500ms.
		rb.onStart({ ...META, chunkIntervalMs: 500 });
		for (let i = 0; i < 10; i++) rb.onChunk(fakeChunk(1));
		// 10 × 500ms = 5s
		expect(rb.bufferedSeconds).toBe(5);
	});

	test("onError preserves accumulated chunks (user can still save what we got)", () => {
		const rb = new ReplayBuffer();
		rb.onStart(META);
		rb.onChunk(fakeChunk(100));
		rb.onChunk(fakeChunk(200));
		rb.onError(new Error("MediaRecorder boom"));
		// Buffer is NOT cleared — those 300 bytes are still valid WebM.
		// onStop is what clears.
		expect(rb.bufferedChunks).toBe(2);
		const snap = rb.snapshot();
		expect(snap?.blob.size).toBe(300);
	});
});
