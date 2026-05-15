import { describe, expect, test } from "bun:test";
import { createFilterChain } from "./audio-filters";

// Mock AudioContext just enough to verify the graph shape. We don't
// run real audio through it; we just assert what nodes get created
// and how they connect.

class FakeNode {
	connections: FakeNode[] = [];
	connect(other: FakeNode): void { this.connections.push(other); }
	disconnect(): void { this.connections = []; }
}

class FakeGainNode extends FakeNode {
	gain = { value: 1 };
}

class FakeDynamicsCompressorNode extends FakeNode {
	threshold = { value: 0 };
	knee = { value: 0 };
	ratio = { value: 0 };
	attack = { value: 0 };
	release = { value: 0 };
}

class FakeAudioContext {
	createGain(): FakeGainNode { return new FakeGainNode(); }
	createDynamicsCompressor(): FakeDynamicsCompressorNode {
		return new FakeDynamicsCompressorNode();
	}
}

describe("createFilterChain — default (compressor + limiter, no gate)", () => {
	test("input is a passthrough gain (worklet insertion point)", () => {
		const ctx = new FakeAudioContext() as unknown as BaseAudioContext;
		const chain = createFilterChain(ctx);
		const inputPass = chain.input as unknown as FakeGainNode;
		// Passthrough — gain at 1.0 means no level change.
		expect(inputPass.gain.value).toBe(1);
	});

	test("compressor (downstream of input) uses OBS defaults: ratio 10, threshold -18dB", () => {
		const ctx = new FakeAudioContext() as unknown as BaseAudioContext;
		const chain = createFilterChain(ctx);
		const inputPass = chain.input as unknown as FakeNode;
		// First downstream node from input is the compressor.
		const comp = inputPass.connections[0] as unknown as FakeDynamicsCompressorNode;
		expect(comp.threshold.value).toBe(-18);
		expect(comp.knee.value).toBe(6);
		expect(comp.ratio.value).toBe(10);
		expect(comp.attack.value).toBeCloseTo(0.006);
		expect(comp.release.value).toBeCloseTo(0.06);
	});

	test("limiter uses OBS defaults: threshold -6dB, ratio 20, knee 0", () => {
		const ctx = new FakeAudioContext() as unknown as BaseAudioContext;
		const chain = createFilterChain(ctx);
		const lim = chain.output as unknown as FakeDynamicsCompressorNode;
		expect(lim.threshold.value).toBe(-6);
		expect(lim.knee.value).toBe(0);
		expect(lim.ratio.value).toBe(20);
		expect(lim.release.value).toBeCloseTo(0.06);
	});

	test("graph order is input → compressor → limiter", () => {
		const ctx = new FakeAudioContext() as unknown as BaseAudioContext;
		const chain = createFilterChain(ctx);
		const inputPass = chain.input as unknown as FakeNode;
		const lim = chain.output as unknown as FakeNode;
		// input connects to compressor (one downstream node).
		expect(inputPass.connections).toHaveLength(1);
		const comp = inputPass.connections[0] as FakeNode;
		// compressor connects to limiter.
		expect(comp.connections).toContain(lim);
	});

	test("dispose() tears down all nodes", () => {
		const ctx = new FakeAudioContext() as unknown as BaseAudioContext;
		const chain = createFilterChain(ctx);
		const inputPass = chain.input as unknown as FakeNode;
		const lim = chain.output as unknown as FakeNode;
		chain.dispose();
		expect(inputPass.connections).toHaveLength(0);
		expect(lim.connections).toHaveLength(0);
	});
});

describe("createFilterChain — bypass", () => {
	test("bypass=true yields a single passthrough node (input === output)", () => {
		const ctx = new FakeAudioContext() as unknown as BaseAudioContext;
		const chain = createFilterChain(ctx, { bypass: true });
		expect(chain.input).toBe(chain.output);
	});

	test("bypass node is a gain at 1.0 (no level change)", () => {
		const ctx = new FakeAudioContext() as unknown as BaseAudioContext;
		const chain = createFilterChain(ctx, { bypass: true });
		const node = chain.input as unknown as FakeGainNode;
		expect(node.gain.value).toBe(1);
	});

	test("bypass dispose() is idempotent", () => {
		const ctx = new FakeAudioContext() as unknown as BaseAudioContext;
		const chain = createFilterChain(ctx, { bypass: true });
		expect(() => chain.dispose()).not.toThrow();
		expect(() => chain.dispose()).not.toThrow();
	});
});
