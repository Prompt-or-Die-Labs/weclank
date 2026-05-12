import { describe, expect, test } from "bun:test";
import { StreamingAudioScheduler } from "./streaming-scheduler";

// Minimal AudioContext mock — only the bits the scheduler reads. Buffer
// sources and their `start()`/`stop()` calls are stubbed; we just need to
// know they fire in order and that `nextStartTime` advances correctly.

interface MockSource {
	buffer: { duration: number } | null;
	connectedTo: unknown;
	startedAt: number | null;
	stopped: boolean;
	onended: (() => void) | null;
}

function makeMockContext(): {
	ctx: AudioContext;
	destination: AudioNode;
	sources: MockSource[];
	now: { value: number };
} {
	const sources: MockSource[] = [];
	const now = { value: 0 };

	const createBuffer = (channels: number, length: number, rate: number): AudioBuffer => ({
		duration: length / rate,
		length,
		numberOfChannels: channels,
		sampleRate: rate,
		copyToChannel: (): void => {},
		getChannelData: (): Float32Array => new Float32Array(length),
		copyFromChannel: (): void => {},
	} as unknown as AudioBuffer);

	const createBufferSource = (): AudioBufferSourceNode => {
		const node: MockSource = {
			buffer: null,
			connectedTo: null,
			startedAt: null,
			stopped: false,
			onended: null,
		};
		sources.push(node);
		return {
			get buffer(): AudioBuffer | null { return node.buffer as AudioBuffer | null; },
			set buffer(v: AudioBuffer | null) { node.buffer = v as { duration: number } | null; },
			get onended(): (() => void) | null { return node.onended; },
			set onended(v: (() => void) | null) { node.onended = v; },
			connect: (dest: AudioNode): void => { node.connectedTo = dest; },
			disconnect: (): void => {},
			start: (when?: number): void => { node.startedAt = when ?? now.value; },
			stop: (): void => { node.stopped = true; },
		} as unknown as AudioBufferSourceNode;
	};

	const destination = {} as AudioNode;
	const ctx = {
		get currentTime(): number { return now.value; },
		createBuffer,
		createBufferSource,
	} as unknown as AudioContext;
	return { ctx, destination, sources, now };
}

describe("StreamingAudioScheduler", () => {
	test("appendPCM16 schedules buffers that advance the playhead by duration", () => {
		const { ctx, destination, sources, now } = makeMockContext();
		const scheduler = new StreamingAudioScheduler(ctx, destination, 22_050);

		const samples = new Int16Array(22_050); // 1 second of audio
		scheduler.appendPCM16(samples);
		scheduler.appendPCM16(samples);

		expect(sources.length).toBe(2);
		expect(sources[0]!.buffer!.duration).toBeCloseTo(1, 3);
		// First buffer starts ~now (+ tiny ~20ms preroll), second starts after first ends.
		expect(sources[1]!.startedAt!).toBeGreaterThan(sources[0]!.startedAt!);
		expect(sources[1]!.startedAt!).toBeGreaterThanOrEqual(sources[0]!.startedAt! + 1 - 0.001);

		// Advance time past playback to confirm subsequent appends start at "current time".
		now.value = 10;
		scheduler.appendPCM16(samples);
		expect(sources[2]!.startedAt!).toBeGreaterThanOrEqual(10);
	});

	test("empty chunks are skipped", () => {
		const { ctx, destination, sources } = makeMockContext();
		const scheduler = new StreamingAudioScheduler(ctx, destination, 22_050);
		scheduler.appendPCM16(new Int16Array(0));
		expect(sources.length).toBe(0);
	});

	test("stop cancels all queued sources and resets the playhead", () => {
		const { ctx, destination, sources, now } = makeMockContext();
		const scheduler = new StreamingAudioScheduler(ctx, destination, 22_050);
		scheduler.appendPCM16(new Int16Array(22_050));
		scheduler.appendPCM16(new Int16Array(22_050));
		scheduler.stop();
		expect(sources.every((s) => s.stopped)).toBe(true);
		// After stop, the next append should start near the new currentTime,
		// not stacked behind the (now-canceled) buffers.
		now.value = 5;
		scheduler.appendPCM16(new Int16Array(22_050));
		expect(sources[2]!.startedAt!).toBeGreaterThanOrEqual(5);
	});
});
