import { describe, expect, test } from "bun:test";
import { reduceStatsPoll, type Lifecycle } from "./stats-strip";

describe("reduceStatsPoll — state derivation", () => {
	test("maps numeric stats verbatim, defaults zeros", () => {
		const r = reduceStatsPoll({ bitrateKbps: 2048, droppedFrames: 3, timeSeconds: 42 }, {}, 0);
		expect(r.patch.bitrateKbps).toBe(2048);
		expect(r.patch.droppedFrames).toBe(3);
		expect(r.patch.timeSeconds).toBe(42);
		// No lifecycle in stats → defaults to "live" (legacy compat).
		expect(r.patch.lifecycle).toBe("live");
	});

	test("missing numeric fields default to 0", () => {
		const r = reduceStatsPoll({}, {}, 0);
		expect(r.patch.bitrateKbps).toBe(0);
		expect(r.patch.droppedFrames).toBe(0);
		expect(r.patch.timeSeconds).toBe(0);
	});

	test("propagates lifecycle from Bun's supervisor", () => {
		for (const lifecycle of ["idle", "live", "reconnecting", "failed"] satisfies Lifecycle[]) {
			const r = reduceStatsPoll({ lifecycle }, {}, 0);
			expect(r.patch.lifecycle).toBe(lifecycle);
		}
	});

	test("includes reconnect attempt count when reconnecting", () => {
		const r = reduceStatsPoll({ lifecycle: "reconnecting", reconnectAttempt: 3 }, {}, 0);
		expect(r.patch.reconnectAttempt).toBe(3);
	});
});

describe("reduceStatsPoll — toast surface", () => {
	test("no toast when error.message is empty", () => {
		const r = reduceStatsPoll({}, {}, 0);
		expect(r.toast).toBeUndefined();
		expect(r.lastErrorAt).toBe(0);
	});

	test("fires a fatal-tone toast on new error", () => {
		const r = reduceStatsPoll(
			{},
			{ message: "VAAPI driver not installed", at: 1000, severity: "fatal" },
			0,
		);
		expect(r.toast).toEqual({ message: "VAAPI driver not installed", tone: "error" });
		expect(r.lastErrorAt).toBe(1000);
	});

	test("transient-severity errors surface as info-tone, not error-tone", () => {
		const r = reduceStatsPoll(
			{},
			{ message: "Stream dropped — reconnecting", at: 1000, severity: "transient" },
			0,
		);
		expect(r.toast).toEqual({ message: "Stream dropped — reconnecting", tone: "info" });
	});

	test("info-severity surfaces as error-tone (defensive: only transient is special)", () => {
		const r = reduceStatsPoll(
			{},
			{ message: "Encoder swapped", at: 1000, severity: "info" },
			0,
		);
		// "info" severity is rare; treat as error-tone so it isn't silently lost.
		expect(r.toast?.tone).toBe("error");
	});

	test("does NOT re-fire the same error twice (at-monotonic dedup)", () => {
		const first = reduceStatsPoll(
			{},
			{ message: "boom", at: 1000, severity: "fatal" },
			0,
		);
		expect(first.toast).toBeDefined();
		// Second poll, same `at` → no new toast.
		const second = reduceStatsPoll(
			{},
			{ message: "boom", at: 1000, severity: "fatal" },
			first.lastErrorAt,
		);
		expect(second.toast).toBeUndefined();
	});

	test("fires a fresh toast when `at` advances (newer error)", () => {
		const first = reduceStatsPoll(
			{},
			{ message: "first", at: 1000, severity: "fatal" },
			0,
		);
		const second = reduceStatsPoll(
			{},
			{ message: "second", at: 2000, severity: "fatal" },
			first.lastErrorAt,
		);
		expect(second.toast?.message).toBe("second");
		expect(second.lastErrorAt).toBe(2000);
	});
});

describe("reduceStatsPoll — combined live + reconnect scenarios", () => {
	test("reconnect-attempt scenario: pill state + transient toast both present", () => {
		const r = reduceStatsPoll(
			{ lifecycle: "reconnecting", reconnectAttempt: 2, bitrateKbps: 0 },
			{ message: "Stream dropped — reconnecting (attempt 2).", at: 1500, severity: "transient" },
			0,
		);
		expect(r.patch.lifecycle).toBe("reconnecting");
		expect(r.patch.reconnectAttempt).toBe(2);
		expect(r.toast?.tone).toBe("info");
	});

	test("failed scenario: pill + error toast", () => {
		const r = reduceStatsPoll(
			{ lifecycle: "failed" },
			{ message: "Stream lost — couldn't reconnect", at: 5000, severity: "fatal" },
			0,
		);
		expect(r.patch.lifecycle).toBe("failed");
		expect(r.toast?.tone).toBe("error");
	});
});
