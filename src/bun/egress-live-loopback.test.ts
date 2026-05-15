// End-to-end "go-live" loopback test.
//
// Spawns a receiver ffmpeg that listens on a local RTMP port, then
// uses our actual EgressSupervisor + buildFfmpegArgs to publish a
// short test pattern as if it were a real broadcast. Verifies:
//   - Real RTMP handshake completes (no protocol mismatch).
//   - Bytes flow end-to-end (receiver writes a non-empty FLV file).
//   - Lifecycle transitions land in `live` for the duration.
//   - stop() exits cleanly with state=idle.
//   - Kill-receiver-mid-stream triggers `reconnecting`.
//
// This is the closest we get to "going live to Twitch" without
// actually streaming to Twitch — exercises the same code paths
// (supervisor + args + real ffmpeg + real RTMP) just with a local
// loopback destination instead of a public one.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { buildFfmpegArgs } from "./egress";
import { createEgressSupervisor } from "./egress-supervisor";
import { augmentedProcessEnv } from "./ffmpeg-env";

const HAS_FFMPEG = await (async (): Promise<boolean> => {
	try {
		const p = Bun.spawn(["ffmpeg", "-version"], { stdout: "pipe", stderr: "pipe", env: augmentedProcessEnv() });
		const code = await p.exited;
		return code === 0;
	} catch {
		return false;
	}
})();

// Generate a known-good seed WebM blob once for all tests below.
let seedWebm: Uint8Array | null = null;

beforeAll(async () => {
	if (!HAS_FFMPEG) return;
	const seed = Bun.spawn(
		[
			"ffmpeg",
			"-hide_banner",
			"-loglevel", "error",
			"-f", "lavfi",
			"-i", "testsrc=duration=3:size=320x240:rate=10",
			"-f", "lavfi",
			"-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
			"-c:v", "libvpx",
			"-c:a", "libopus",
			"-b:v", "200k",
			"-b:a", "32k",
			"-shortest",
			"-f", "webm",
			"-",
		],
		{ stdout: "pipe", stderr: "pipe", env: augmentedProcessEnv() },
	);
	const buf = await new Response(seed.stdout).arrayBuffer();
	await seed.exited;
	seedWebm = new Uint8Array(buf);
});

afterAll(async () => {
	seedWebm = null;
});

interface Receiver {
	proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
	port: number;
	url: string;
	outPath: string;
	stop(): Promise<void>;
	bytesReceived(): Promise<number>;
}

async function startReceiver(): Promise<Receiver> {
	// Random high port in the 12000-13000 range to avoid collisions
	// across test parallelism.
	const port = 12000 + Math.floor(Math.random() * 1000);
	const url = `rtmp://127.0.0.1:${port}/live/test`;
	const outPath = `/tmp/wcl-rtmp-recv-${port}.flv`;
	if (existsSync(outPath)) await unlink(outPath);

	const proc = Bun.spawn(
		[
			"ffmpeg",
			"-hide_banner",
			"-loglevel", "warning",
			"-listen", "1",
			"-f", "flv",
			"-i", url,
			"-c", "copy",
			"-y", outPath,
		],
		{ stdin: "pipe", stdout: "pipe", stderr: "pipe", env: augmentedProcessEnv() },
	) as Bun.Subprocess<"pipe", "pipe", "pipe">;

	// Wait for the listener to bind. The receiver prints
	// "Connection from..." once a publisher connects; before that
	// it just sits waiting. A 600ms delay is conservative.
	await new Promise((r) => setTimeout(r, 600));

	return {
		proc,
		port,
		url,
		outPath,
		async stop(): Promise<void> {
			try { proc.kill("SIGINT"); } catch { /* may already be dead */ }
			try {
				await Promise.race([
					proc.exited,
					new Promise((r) => setTimeout(r, 2_000)),
				]);
			} catch { /* noop */ }
			try { if (existsSync(outPath)) await unlink(outPath); } catch { /* noop */ }
		},
		async bytesReceived(): Promise<number> {
			if (!existsSync(outPath)) return 0;
			return (await Bun.file(outPath).bytes()).byteLength;
		},
	};
}

describe.skipIf(!HAS_FFMPEG)("egress LIVE loopback (real RTMP end-to-end)", () => {
	test("publishes via EgressSupervisor; receiver writes a non-empty FLV", async () => {
		const receiver = await startReceiver();
		try {
			const args = buildFfmpegArgs({
				encoder: {
					name: "libx264",
					extraArgs: ["-preset", "ultrafast", "-tune", "zerolatency"],
					label: "live-loopback",
				},
				targets: [receiver.url],
				fps: 10,
				videoBitsPerSecond: 200_000,
				audioBitsPerSecond: 32_000,
			});

			const sup = createEgressSupervisor({
				args,
				env: augmentedProcessEnv(),
			});

			await sup.start();
			// Supervisor lands in `starting`; production promotes to `live`
			// once ffmpeg emits its first `-progress pipe:1` block. This
			// test exercises the lifecycle by simulating that callback.
			sup.noteActivity();
			expect(sup.getState().kind).toBe("live");

			// Feed the seed WebM in. Split into small chunks to
			// mirror MediaRecorder's 1-second cadence.
			expect(seedWebm).toBeTruthy();
			const buf = seedWebm!;
			const CHUNK = 4096;
			for (let i = 0; i < buf.length; i += CHUNK) {
				const ok = await sup.write(buf.subarray(i, Math.min(i + CHUNK, buf.length)));
				expect(ok).toBe(true);
			}

			// Give ffmpeg time to encode + the receiver time to flush.
			await new Promise((r) => setTimeout(r, 1_500));
			await sup.stop();

			// Receiver needs a moment to finalise the FLV header before exit.
			await new Promise((r) => setTimeout(r, 500));
			const bytes = await receiver.bytesReceived();
			expect(bytes).toBeGreaterThan(1_000); // a meaningful FLV is far more than 1KB
		} finally {
			await receiver.stop();
		}
	}, 20_000);

	test("stop() during live RTMP returns supervisor to idle", async () => {
		const receiver = await startReceiver();
		try {
			const args = buildFfmpegArgs({
				encoder: {
					name: "libx264",
					extraArgs: ["-preset", "ultrafast", "-tune", "zerolatency"],
					label: "stop-test",
				},
				targets: [receiver.url],
				fps: 10,
				videoBitsPerSecond: 200_000,
			});
			const sup = createEgressSupervisor({ args, env: augmentedProcessEnv() });
			await sup.start();
			sup.noteActivity();
			expect(sup.getState().kind).toBe("live");

			// Push at least one chunk so the RTMP handshake completes.
			await sup.write(seedWebm!.subarray(0, 4096));
			await new Promise((r) => setTimeout(r, 200));

			const t0 = Date.now();
			await sup.stop();
			const elapsed = Date.now() - t0;
			expect(sup.getState().kind).toBe("idle");
			// Clean stop should take well under the 3s outer-cap.
			expect(elapsed).toBeLessThan(3_000);
		} finally {
			await receiver.stop();
		}
	}, 15_000);

	test("ffmpeg crash mid-stream triggers reconnecting + recovery", async () => {
		// Test design note: killing the RTMP *receiver* doesn't reliably
		// reproduce a disconnect in <30s because ffmpeg's RTMP writer
		// buffers heavily and doesn't see the dead socket immediately.
		// (This is exactly the failure mode the P1 `StaleTimeout`
		// watcher addresses — "if no frames in N seconds, kill the
		// process".) For now we exercise the supervisor's responsibility
		// — process lifecycle management — by killing ffmpeg itself.
		// Whether ffmpeg detects a remote socket death promptly is a
		// separate concern handled by StaleTimeout.

		const receiver = await startReceiver();
		try {
			const args = buildFfmpegArgs({
				encoder: {
					name: "libx264",
					extraArgs: ["-preset", "ultrafast", "-tune", "zerolatency"],
					label: "reconnect-test",
				},
				targets: [receiver.url],
				fps: 10,
				videoBitsPerSecond: 200_000,
			});

			const observedKinds: string[] = [];
			const sup = createEgressSupervisor({
				args,
				env: augmentedProcessEnv(),
				initialReconnectDelayMs: 100,
				maxReconnectAttempts: 5,
				onState: (s) => observedKinds.push(s.kind),
			});

			await sup.start();
			sup.noteActivity();
			await sup.write(seedWebm!.subarray(0, 4096));
			await new Promise((r) => setTimeout(r, 400));
			expect(sup.getState().kind).toBe("live");

			const preKillCount = observedKinds.length;

			// Kill the actual ffmpeg subprocess. We don't have a direct
			// handle exposed (intentionally — supervisor owns its child)
			// so use pkill-by-unique-marker. The receiver.url is unique
			// per test run, so we grep the ffmpeg arg list for it.
			const pkill = Bun.spawnSync(["pkill", "-9", "-f", receiver.url]);
			expect([0, 1]).toContain(pkill.exitCode); // 0=killed, 1=nothing-matched

			// The supervisor's exit-watcher detects the dead child,
			// schedules respawn. The new ffmpeg may succeed (receiver
			// still up) or fail; either way we should observe
			// reconnecting in the transition trail.
			await new Promise((r) => setTimeout(r, 1_500));

			const postKill = observedKinds.slice(preKillCount);
			expect(postKill).toContain("reconnecting");

			await sup.stop();
			expect(sup.getState().kind).toBe("idle");
		} finally {
			await receiver.stop();
		}
	}, 30_000);
});
