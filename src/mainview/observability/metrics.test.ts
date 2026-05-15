import { describe, expect, test } from "bun:test";
import {
	NoOpMetricsCollector,
	RingBufferMetricsCollector,
} from "./metrics";

describe("RingBufferMetricsCollector", () => {
	test("counters accumulate as running total", () => {
		const m = new RingBufferMetricsCollector();
		m.incrementCounter("egress.chunks");
		m.incrementCounter("egress.chunks");
		m.addCounter("egress.chunks", 3);
		const s = m.snapshot("egress.chunks");
		expect(s).toEqual({ kind: "counter", total: 5 });
	});

	test("counters with different labels are independent series", () => {
		const m = new RingBufferMetricsCollector();
		m.incrementCounter("egress.chunks", { dest: "twitch" });
		m.incrementCounter("egress.chunks", { dest: "twitch" });
		m.incrementCounter("egress.chunks", { dest: "youtube" });
		expect(m.snapshot("egress.chunks", { dest: "twitch" })).toEqual({ kind: "counter", total: 2 });
		expect(m.snapshot("egress.chunks", { dest: "youtube" })).toEqual({ kind: "counter", total: 1 });
	});

	test("label key order doesn't matter for series identity", () => {
		const m = new RingBufferMetricsCollector();
		m.incrementCounter("foo", { a: "1", b: "2" });
		m.incrementCounter("foo", { b: "2", a: "1" });
		expect(m.snapshot("foo", { a: "1", b: "2" })).toEqual({ kind: "counter", total: 2 });
	});

	test("histograms surface p50/p95/p99/max", () => {
		const m = new RingBufferMetricsCollector();
		for (let i = 1; i <= 100; i++) m.recordValue("latency", i);
		const s = m.snapshot("latency");
		expect(s?.kind).toBe("histogram");
		if (s?.kind === "histogram") {
			expect(s.count).toBe(100);
			expect(s.p50).toBeGreaterThanOrEqual(50);
			expect(s.p50).toBeLessThanOrEqual(51);
			expect(s.p95).toBeGreaterThanOrEqual(95);
			expect(s.p99).toBeGreaterThanOrEqual(99);
			expect(s.max).toBe(100);
		}
	});

	test("recordLatency is a histogram alias", () => {
		const m = new RingBufferMetricsCollector();
		m.recordLatency("op_duration_ms", 123);
		m.recordLatency("op_duration_ms", 456);
		const s = m.snapshot("op_duration_ms");
		expect(s?.kind).toBe("histogram");
		if (s?.kind === "histogram") expect(s.count).toBe(2);
	});

	test("gauges overwrite", () => {
		const m = new RingBufferMetricsCollector();
		m.setGauge("fps", 30);
		m.setGauge("fps", 28.5);
		expect(m.snapshot("fps")).toEqual({ kind: "gauge", current: 28.5 });
	});

	test("historyDepth caps ring buffer", () => {
		const m = new RingBufferMetricsCollector({ historyDepth: 3 });
		m.recordValue("x", 1);
		m.recordValue("x", 2);
		m.recordValue("x", 3);
		m.recordValue("x", 4);
		const s = m.snapshot("x");
		if (s?.kind === "histogram") expect(s.count).toBe(3);
	});

	test("snapshot of an unknown series returns undefined", () => {
		const m = new RingBufferMetricsCollector();
		expect(m.snapshot("never-set")).toBeUndefined();
	});

	test("keys() enumerates all series with their label hash", () => {
		const m = new RingBufferMetricsCollector();
		m.incrementCounter("a");
		m.incrementCounter("b", { x: "1" });
		const keys = m.keys();
		expect(keys).toContain("a");
		expect(keys).toContain("b{x=1}");
	});
});

describe("NoOpMetricsCollector", () => {
	test("all methods are silent", () => {
		const m = new NoOpMetricsCollector();
		// Just verify nothing throws.
		m.incrementCounter("x");
		m.addCounter("x", 5);
		m.recordLatency("y", 100);
		m.recordValue("z", 1);
		m.setGauge("g", 42);
	});
});
