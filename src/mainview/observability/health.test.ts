import { describe, expect, test } from "bun:test";
import {
	HealthAggregator,
	activeSceneNonEmptyCheck,
	audioContextCheck,
	ffmpegAliveCheck,
} from "./health";

describe("HealthAggregator", () => {
	test("all-healthy required checks → healthy", async () => {
		const a = new HealthAggregator({ timeoutMs: 100 });
		a.register("noop1", async () => {});
		a.register("noop2", async () => {});
		const r = await a.check();
		expect(r.status).toBe("healthy");
		expect(r.components).toHaveLength(2);
		expect(r.components.every((c) => c.status === "healthy")).toBe(true);
	});

	test("failed required check → unhealthy", async () => {
		const a = new HealthAggregator({ timeoutMs: 100 });
		a.register("ok", async () => {});
		a.register("bad", async () => {
			throw new Error("nope");
		});
		const r = await a.check();
		expect(r.status).toBe("unhealthy");
		const bad = r.components.find((c) => c.name === "bad");
		expect(bad?.status).toBe("unhealthy");
		expect(bad?.message).toBe("nope");
	});

	test("failed optional check → degraded", async () => {
		const a = new HealthAggregator({ timeoutMs: 100 });
		a.register("required-ok", async () => {});
		a.registerOptional("optional-bad", async () => {
			throw new Error("flaky");
		});
		const r = await a.check();
		expect(r.status).toBe("degraded");
	});

	test("required failure trumps optional failure", async () => {
		const a = new HealthAggregator({ timeoutMs: 100 });
		a.register("req-bad", async () => {
			throw new Error("required");
		});
		a.registerOptional("opt-bad", async () => {
			throw new Error("optional");
		});
		const r = await a.check();
		expect(r.status).toBe("unhealthy");
	});

	test("per-check timeout fails the check", async () => {
		const a = new HealthAggregator({ timeoutMs: 30 });
		a.register("slow", async (signal) => {
			await new Promise((resolve, reject) => {
				const t = setTimeout(resolve, 500);
				signal.addEventListener("abort", () => {
					clearTimeout(t);
					reject(new Error("aborted"));
				});
			});
		});
		const r = await a.check();
		expect(r.status).toBe("unhealthy");
		expect(r.components[0]?.message).toMatch(/abort/i);
	});

	test("checks run in parallel (total time ~ slowest, not sum)", async () => {
		const a = new HealthAggregator({ timeoutMs: 500 });
		for (let i = 0; i < 5; i++) {
			a.register(`slow-${i}`, async () => {
				await new Promise((r) => setTimeout(r, 50));
			});
		}
		const start = Date.now();
		await a.check();
		const elapsed = Date.now() - start;
		// 5 × 50ms in parallel should be ~50ms not ~250ms; allow generous slack.
		expect(elapsed).toBeLessThan(200);
	});

	test("unregister removes a check", async () => {
		const a = new HealthAggregator();
		a.register("temp", async () => {});
		expect(a.listRegistered()).toContain("temp");
		a.unregister("temp");
		expect(a.listRegistered()).not.toContain("temp");
	});
});

describe("Pre-built check factories", () => {
	test("audioContextCheck passes when state=running", async () => {
		const fakeCtx = { state: "running" as AudioContextState } as AudioContext;
		const check = audioContextCheck(() => fakeCtx);
		const controller = new AbortController();
		await expect(check(controller.signal)).resolves.toBeUndefined();
	});

	test("audioContextCheck fails when state=suspended", async () => {
		const fakeCtx = { state: "suspended" as AudioContextState } as AudioContext;
		const check = audioContextCheck(() => fakeCtx);
		const controller = new AbortController();
		await expect(check(controller.signal)).rejects.toThrow(/suspended/);
	});

	test("activeSceneNonEmptyCheck passes with count>0, fails with 0", async () => {
		let count = 3;
		const check = activeSceneNonEmptyCheck(() => count);
		await expect(check(new AbortController().signal)).resolves.toBeUndefined();
		count = 0;
		await expect(check(new AbortController().signal)).rejects.toThrow(/empty/i);
	});

	test("ffmpegAliveCheck passes when probe returns true", async () => {
		const check = ffmpegAliveCheck(async () => true);
		await expect(check(new AbortController().signal)).resolves.toBeUndefined();
	});

	test("ffmpegAliveCheck fails when probe returns false", async () => {
		const check = ffmpegAliveCheck(async () => false);
		await expect(check(new AbortController().signal)).rejects.toThrow(/not alive/i);
	});
});
