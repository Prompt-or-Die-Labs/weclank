import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
	NoOpMetricsCollector,
	RingBufferMetricsCollector,
	setMetricsCollector,
} from "./metrics";
import { timed, timedSync } from "./timed";

let collector: RingBufferMetricsCollector;

beforeEach(() => {
	collector = new RingBufferMetricsCollector();
	setMetricsCollector(collector);
});

afterEach(() => {
	// Restore the default singleton state so other tests don't leak.
	setMetricsCollector(new RingBufferMetricsCollector());
});

describe("timed", () => {
	test("records duration on success with ok=true", async () => {
		const result = await timed("op", async () => {
			await new Promise((r) => setTimeout(r, 10));
			return "value";
		});
		expect(result).toBe("value");
		const s = collector.snapshot("op_duration_ms", { ok: "true" });
		expect(s?.kind).toBe("histogram");
		if (s?.kind === "histogram") {
			expect(s.count).toBe(1);
			expect(s.max).toBeGreaterThan(0);
		}
	});

	test("records duration on failure with ok=false and rethrows", async () => {
		const err = new Error("boom");
		await expect(
			timed("op", async () => {
				throw err;
			}),
		).rejects.toThrow("boom");
		const s = collector.snapshot("op_duration_ms", { ok: "false" });
		expect(s?.kind).toBe("histogram");
		if (s?.kind === "histogram") expect(s.count).toBe(1);
	});

	test("with NoOp collector swap, no series accumulates", async () => {
		setMetricsCollector(new NoOpMetricsCollector());
		await timed("op", async () => "ok");
		// Re-install ring buffer just to be able to inspect — should be empty.
		setMetricsCollector(collector);
		expect(collector.snapshot("op_duration_ms", { ok: "true" })).toBeUndefined();
	});
});

describe("timedSync", () => {
	test("records duration on success", () => {
		const result = timedSync("sync_op", () => 42);
		expect(result).toBe(42);
		const s = collector.snapshot("sync_op_duration_ms", { ok: "true" });
		expect(s?.kind).toBe("histogram");
	});

	test("records duration on throw and rethrows", () => {
		expect(() =>
			timedSync("sync_op", () => {
				throw new Error("nope");
			}),
		).toThrow("nope");
		const s = collector.snapshot("sync_op_duration_ms", { ok: "false" });
		expect(s?.kind).toBe("histogram");
	});
});
