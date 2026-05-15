import { describe, expect, test } from "bun:test";
import {
	currentError,
	currentStats,
	hasActiveSession,
	stopEgressSession,
	startEgressSession,
} from "./egress-session";
import { augmentedProcessEnv } from "./ffmpeg-env";

const HAS_FFMPEG = await (async (): Promise<boolean> => {
	try {
		const p = Bun.spawn(["ffmpeg", "-version"], { stdout: "pipe", stderr: "pipe", env: augmentedProcessEnv() });
		return (await p.exited) === 0;
	} catch {
		return false;
	}
})();

describe("egress-session — idle state", () => {
	test("hasActiveSession is false before start", () => {
		expect(hasActiveSession()).toBe(false);
	});

	test("currentStats returns idle lifecycle with no stats", () => {
		const s = currentStats();
		expect(s.lifecycle).toBe("idle");
		expect(s.fps).toBeUndefined();
		expect(s.bitrateKbps).toBeUndefined();
	});

	test("currentError returns an empty object when nothing's wrong", () => {
		expect(currentError()).toEqual({});
	});

	test("stopEgressSession on idle is a no-op success", async () => {
		const r = await stopEgressSession();
		expect(r.success).toBe(true);
	});
});

describe("egress-session — input validation (no ffmpeg spawn required)", () => {
	test("empty destinations rejected", async () => {
		const r = await startEgressSession({
			destinations: [],
			fps: 30,
			videoBitsPerSecond: 2_500_000,
			encoder: { name: "libx264", extraArgs: [], label: "x264" },
		});
		expect(r.success).toBe(false);
		if (!r.success) expect(r.error).toMatch(/no destinations/i);
	});

	test("non-positive fps rejected", async () => {
		const r = await startEgressSession({
			destinations: [{ rtmpUrl: "rtmp://example.com/live", streamKey: "k" }],
			fps: 0,
			videoBitsPerSecond: 2_500_000,
			encoder: { name: "libx264", extraArgs: [], label: "x264" },
		});
		expect(r.success).toBe(false);
		if (!r.success) expect(r.error).toMatch(/fps/i);
	});

	test("non-positive bitrate rejected", async () => {
		const r = await startEgressSession({
			destinations: [{ rtmpUrl: "rtmp://example.com/live", streamKey: "k" }],
			fps: 30,
			videoBitsPerSecond: -1,
			encoder: { name: "libx264", extraArgs: [], label: "x264" },
		});
		expect(r.success).toBe(false);
		if (!r.success) expect(r.error).toMatch(/videoBitsPerSecond/i);
	});

	test("non-rtmp URLs rejected", async () => {
		const r = await startEgressSession({
			destinations: [{ rtmpUrl: "https://wrong-protocol.example.com/", streamKey: "k" }],
			fps: 30,
			videoBitsPerSecond: 2_500_000,
			encoder: { name: "libx264", extraArgs: [], label: "x264" },
		});
		expect(r.success).toBe(false);
		if (!r.success) expect(r.error).toMatch(/rtmp/);
	});
});

describe.skipIf(!HAS_FFMPEG)("egress-session — full lifecycle (requires ffmpeg)", () => {
	test("start → hasActiveSession=true; stop → idle", async () => {
		// Use an unroutable RTMP destination but with a very tight
		// settle window so we get past initial spawn (ffmpeg won't
		// fail-connect within 200ms for non-existent hosts) and into
		// `live` state.
		const r = await startEgressSession({
			destinations: [{ rtmpUrl: "rtmp://127.0.0.1:9", streamKey: "test" }],
			fps: 10,
			videoBitsPerSecond: 200_000,
			encoder: { name: "libx264", extraArgs: ["-preset", "ultrafast"], label: "test" },
		});
		// Real ffmpeg gets past settle (it takes > 200ms to fail the
		// RTMP handshake to a closed port). It then transitions to
		// reconnecting once the connection-refused result comes back.
		expect(r.success).toBe(true);
		expect(hasActiveSession()).toBe(true);

		await stopEgressSession();
		expect(hasActiveSession()).toBe(false);
		expect(currentStats().lifecycle).toBe("idle");
	}, 15_000);
});
