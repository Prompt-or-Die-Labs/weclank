import { describe, expect, test } from "bun:test";
import { withBackoff, reconnectLoop } from "./retry";

describe("withBackoff", () => {
	test("returns the value on first success without retry", async () => {
		let attempts = 0;
		const result = await withBackoff(async () => {
			attempts++;
			return 42;
		});
		expect(result).toBe(42);
		expect(attempts).toBe(1);
	});

	test("retries on failure, succeeds on a later attempt", async () => {
		let attempts = 0;
		const result = await withBackoff(
			async () => {
				attempts++;
				if (attempts < 3) throw new Error("transient");
				return "ok";
			},
			{ initialDelayMs: 5, maxDelayMs: 20, onAttemptFailed: () => {} },
		);
		expect(result).toBe("ok");
		expect(attempts).toBe(3);
	});

	test("throws the last error after exhausting attempts", async () => {
		let attempts = 0;
		await expect(
			withBackoff(
				async () => {
					attempts++;
					throw new Error(`bad-${attempts}`);
				},
				{ maxAttempts: 3, initialDelayMs: 1, onAttemptFailed: () => {} },
			),
		).rejects.toThrow("bad-3");
		expect(attempts).toBe(3);
	});

	test("respects an abort signal mid-wait", async () => {
		const controller = new AbortController();
		const promise = withBackoff(
			async () => {
				throw new Error("always");
			},
			{ maxAttempts: 5, initialDelayMs: 50, signal: controller.signal, onAttemptFailed: () => {} },
		);
		setTimeout(() => controller.abort(), 10);
		await expect(promise).rejects.toThrow();
	});

	test("onAttemptFailed receives the attempt number and error", async () => {
		const calls: Array<{ n: number; msg: string }> = [];
		await withBackoff(
			async () => {
				throw new Error("e");
			},
			{
				maxAttempts: 2,
				initialDelayMs: 1,
				onAttemptFailed: (n, err) => calls.push({ n, msg: (err as Error).message }),
			},
		).catch(() => {});
		expect(calls).toEqual([
			{ n: 1, msg: "e" },
			{ n: 2, msg: "e" },
		]);
	});
});

describe("reconnectLoop", () => {
	test("stops when the signal aborts", async () => {
		const controller = new AbortController();
		let runs = 0;
		const promise = reconnectLoop(
			async () => {
				runs++;
				// Resolve immediately so the loop sleeps + retries.
			},
			{ initialDelayMs: 5, maxDelayMs: 20, signal: controller.signal, label: "test" },
		);
		setTimeout(() => controller.abort(), 50);
		await promise;
		// Should have run at least once before the abort.
		expect(runs).toBeGreaterThan(0);
	});

	test("keeps reconnecting after thrown errors", async () => {
		const controller = new AbortController();
		let runs = 0;
		const drops: unknown[] = [];
		const promise = reconnectLoop(
			async () => {
				runs++;
				throw new Error("dropped");
			},
			{
				initialDelayMs: 1,
				maxDelayMs: 10,
				signal: controller.signal,
				label: "test",
				onDrop: (err) => drops.push(err),
			},
		);
		setTimeout(() => controller.abort(), 30);
		await promise;
		// Multiple drops + reconnects within 30ms.
		expect(runs).toBeGreaterThan(1);
		expect(drops.length).toBeGreaterThan(0);
	});
});
