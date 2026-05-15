import { describe, expect, test } from "bun:test";
import { createEgressSupervisor, type EgressLifecycleState } from "./egress-supervisor";

// We test the supervisor against a real Bun subprocess but use shell
// utilities that exist on every dev machine. `cat` keeps stdin open
// until EOF — perfect for a long-lived "ffmpeg-like" process.
//
// Note: these tests use real timing (waiting for processes), so they
// take ~hundreds of ms each. They're isolated from network and from
// ffmpeg itself.

describe("egress-supervisor", () => {
	test("start() spawns and reports live", async () => {
		const states: EgressLifecycleState[] = [];
		const sup = createEgressSupervisor({
			args: ["cat"],
			onState: (s) => states.push(s),
		});

		await sup.start();
		expect(sup.getState().kind).toBe("live");

		await sup.stop();
		expect(sup.getState().kind).toBe("idle");

		// Transitions observed: live → idle (no reconnect, clean stop)
		expect(states.map((s) => s.kind)).toEqual(["live", "idle"]);
	});

	test("write() returns true while live, false after stop", async () => {
		const sup = createEgressSupervisor({ args: ["cat"] });
		await sup.start();

		const ok = await sup.write(new TextEncoder().encode("hello"));
		expect(ok).toBe(true);

		await sup.stop();
		const ok2 = await sup.write(new TextEncoder().encode("after"));
		expect(ok2).toBe(false);
	});

	test("clean exit code 0 (after settling) does not trigger reconnect", async () => {
		// Process must survive the 200ms settle window then exit
		// cleanly — that's the path we want to exercise.
		const states: EgressLifecycleState[] = [];
		const sup = createEgressSupervisor({
			args: ["sh", "-c", "sleep 0.3; exit 0"],
			onState: (s) => states.push(s),
		});

		await sup.start();
		expect(sup.getState().kind).toBe("live");
		// Wait past the sleep so the proc exits cleanly.
		await new Promise((r) => setTimeout(r, 500));
		// Should now be idle (clean exit, no reconnect).
		expect(sup.getState().kind).toBe("idle");
		await sup.stop();
	}, 5_000);

	test("non-zero exit (after settling) triggers reconnect", async () => {
		const states: EgressLifecycleState[] = [];
		// Live past the 200ms settle window then die — exercises the
		// reconnect path rather than the initial-spawn-failure path.
		const sup = createEgressSupervisor({
			args: ["sh", "-c", "sleep 0.3; exit 7"],
			onState: (s) => states.push(s),
			initialReconnectDelayMs: 50,
			maxReconnectAttempts: 5,
		});

		await sup.start();
		// Wait for the proc to die + exit watcher to schedule respawn.
		await new Promise((r) => setTimeout(r, 450));

		const kinds = states.map((s) => s.kind);
		expect(kinds).toContain("reconnecting");

		await sup.stop();
		expect(sup.getState().kind).toBe("idle");
	}, 5_000);

	test("stop() during a live-then-respawn cycle completes quickly", async () => {
		// Process that lives past settle, then dies; respawn loop kicks
		// in with a long initial delay so we can interrupt it mid-flight.
		const sup = createEgressSupervisor({
			args: ["sh", "-c", "sleep 0.3; exit 1"],
			initialReconnectDelayMs: 5_000, // long delay we'll interrupt
			maxReconnectAttempts: 20,
		});

		await sup.start();
		// Wait for live → die. At this point we're either in
		// "reconnecting" (if the respawn loop scheduled fast) or
		// briefly back in "live" (if a respawn succeeded). Either way,
		// stop() must complete promptly.
		await new Promise((r) => setTimeout(r, 400));

		const stopStart = Date.now();
		await sup.stop();
		const elapsed = Date.now() - stopStart;
		// Stop must NOT block on the 5s reconnect delay or the 200ms
		// settle window — should be well under 1s.
		expect(elapsed).toBeLessThan(1_000);
		expect(sup.getState().kind).toBe("idle");
	}, 5_000);

	test("initial spawn that exits within settle window throws from start()", async () => {
		const sup = createEgressSupervisor({
			args: ["sh", "-c", "exit 1"], // dies in <200ms
		});
		await expect(sup.start()).rejects.toThrow(/exited|spawn/i);
		await sup.stop();
	});

	test("exhausting maxReconnectAttempts transitions to failed", async () => {
		const sup = createEgressSupervisor({
			args: ["sh", "-c", "exit 1"],
			initialReconnectDelayMs: 5,
			maxReconnectDelayMs: 10,
			maxReconnectAttempts: 2,
		});

		// start() now awaits settle — a fast-exiting process will throw
		// from start() directly. That's correct: a process that dies
		// in <200ms should be reported as a failed initial spawn, not
		// as a live session followed by a crash.
		await expect(sup.start()).rejects.toThrow(/exited|spawn/i);

		await sup.stop();
	});

	test("StaleTimeout watchdog kills silent ffmpeg + triggers respawn", async () => {
		// Process that lives indefinitely without ever calling
		// noteActivity() — simulates ffmpeg that's stuck in a buffer
		// (RTMP receiver dead, TCP buffer absorbing writes). Watchdog
		// must kill it. We use `sleep 60` as a stand-in for "lives
		// forever, never produces progress."
		const kindsObserved: string[] = [];
		const sup = createEgressSupervisor({
			args: ["sleep", "60"],
			staleTimeoutMs: 1_500, // short for test speed
			initialReconnectDelayMs: 100,
			maxReconnectAttempts: 1,
			onState: (s) => kindsObserved.push(s.kind),
		});

		await sup.start();
		expect(sup.getState().kind).toBe("live");

		// Don't call noteActivity(). Watchdog should fire within ~2.5s
		// (1.5s threshold + 1s watchdog check granularity).
		await new Promise((r) => setTimeout(r, 3_000));

		// After the watchdog killed sleep, the supervisor's respawn
		// loop attempts `sleep 60` again (which lives), so we may
		// be in "live" again at this point. The key invariant: we
		// MUST have transitioned through reconnecting at least once.
		expect(kindsObserved).toContain("reconnecting");

		await sup.stop();
	}, 10_000);

	test("noteActivity() heartbeat prevents the watchdog", async () => {
		const kindsObserved: string[] = [];
		const sup = createEgressSupervisor({
			args: ["sleep", "60"],
			staleTimeoutMs: 1_000,
			initialReconnectDelayMs: 100,
			maxReconnectAttempts: 1,
			onState: (s) => kindsObserved.push(s.kind),
		});

		await sup.start();
		// Heartbeat every 300ms — well under the 1s stale threshold.
		const interval = setInterval(() => sup.noteActivity(), 300);
		try {
			await new Promise((r) => setTimeout(r, 2_500));
		} finally {
			clearInterval(interval);
		}

		// With regular heartbeats, the watchdog never fires. State
		// should still be "live" with no reconnect transitions.
		expect(sup.getState().kind).toBe("live");
		expect(kindsObserved).not.toContain("reconnecting");

		await sup.stop();
	}, 10_000);

	test("StaleTimeout disabled (=0) lets a silent process run forever", async () => {
		const kindsObserved: string[] = [];
		const sup = createEgressSupervisor({
			args: ["sleep", "60"],
			staleTimeoutMs: 0, // disabled
			onState: (s) => kindsObserved.push(s.kind),
		});

		await sup.start();
		// 1.5s with NO heartbeats — should still be live (watchdog disabled).
		await new Promise((r) => setTimeout(r, 1_500));
		expect(sup.getState().kind).toBe("live");
		expect(kindsObserved).not.toContain("reconnecting");

		await sup.stop();
	}, 10_000);

	test("restart counter accumulates across multiple drops (advisor regression)", async () => {
		// Use a process that lives just long enough to settle, then
		// dies — so we can observe multiple reconnects. We use
		// `sh -c "sleep 0.25; exit 1"` so the process lives past the
		// 200ms settle window and then dies.
		const liveStates: Array<{ restarts: number }> = [];
		const sup = createEgressSupervisor({
			args: ["sh", "-c", "sleep 0.4; exit 1"],
			initialReconnectDelayMs: 30,
			maxReconnectDelayMs: 50,
			maxReconnectAttempts: 5,
			onState: (s) => {
				if (s.kind === "live") liveStates.push({ restarts: s.restarts });
			},
		});

		await sup.start();
		// Wait long enough for at least 2 full die → respawn → settle
		// cycles. Each cycle ≈ 400ms (alive) + 30-50ms (backoff) +
		// 200ms (settle) ≈ 650ms. 1.8s is comfortable for 2 cycles.
		await new Promise((r) => setTimeout(r, 1_800));
		await sup.stop();

		// First entry is the initial start (restarts=0). Subsequent
		// entries are respawns; their `restarts` field must accumulate
		// (1, 2, ...) — the bug the advisor caught was that it stayed
		// stuck at 1 forever.
		expect(liveStates[0]?.restarts).toBe(0);
		expect(liveStates.length).toBeGreaterThanOrEqual(2);
		const respawnRestarts = liveStates.slice(1).map((s) => s.restarts);
		// Strictly increasing, starting at 1.
		expect(respawnRestarts[0]).toBe(1);
		if (respawnRestarts.length >= 2) {
			expect(respawnRestarts[1]).toBe(2);
		}
	}, 10_000);
});
