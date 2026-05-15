// Smoke test — exercises the real ffmpeg binary with the args our
// buildFfmpegArgs produces. Targets `-f null -` instead of RTMP so we
// don't need network or a streaming destination, but we DO exercise:
//   - real ffmpeg arg parsing (catches "ffmpeg rejected the args")
//   - real WebM demux on stdin (catches "ffmpeg won't accept our pipe")
//   - real video encode (catches "encoder name is wrong on this build")
//
// Per CLAUDE.md: validate by RUNNING the actual feature, not mocks.
// This is the closest we can get without spinning up an RTMP origin.
//
// Skipped if ffmpeg isn't on PATH; covers the buildFfmpegArgs output
// against a real ffmpeg parser.

import { describe, expect, test } from "bun:test";
import { buildFfmpegArgs } from "./egress";
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

describe.skipIf(!HAS_FFMPEG)("ffmpeg smoke (real binary)", () => {
	test("builds args ffmpeg accepts (single-dest, replaced with -f null -)", async () => {
		// Build args for a single RTMP target, then swap the FLV+url
		// output for `-f null -` so we don't actually try to connect.
		const args = buildFfmpegArgs({
			encoder: { name: "libx264", extraArgs: ["-preset", "ultrafast"], label: "smoke" },
			targets: ["rtmp://example.invalid/app/key"],
			fps: 30,
			videoBitsPerSecond: 1_000_000,
		});
		// Find the trailing FLV section and replace it with `-f null -`.
		// Single-dest path: `... -flvflags +no_duration_filesize -f flv <url>`.
		const flvIdx = args.lastIndexOf("-flvflags");
		expect(flvIdx).toBeGreaterThan(0);
		const trimmed = args.slice(0, flvIdx);
		trimmed.push("-f", "null", "-");

		// Generate 1 second of test video into stdin, then close.
		const proc = Bun.spawn(trimmed, {
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
			env: augmentedProcessEnv(),
		});
		// Use ffmpeg itself to generate a tiny WebM blob into a buffer,
		// then write it to the smoke-process's stdin.
		const seedProc = Bun.spawn(
			[
				"ffmpeg",
				"-hide_banner",
				"-loglevel", "error",
				"-f", "lavfi",
				"-i", "testsrc=duration=0.5:size=320x240:rate=10",
				"-f", "lavfi",
				"-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
				"-c:v", "libvpx",
				"-c:a", "libopus",
				"-b:v", "100k",
				"-b:a", "32k",
				"-shortest",
				"-f", "webm",
				"-",
			],
			{ stdout: "pipe", stderr: "pipe", env: augmentedProcessEnv() },
		);
		const webm = await new Response(seedProc.stdout).arrayBuffer();
		await seedProc.exited;
		expect(webm.byteLength).toBeGreaterThan(100);

		// Pipe the seed WebM into the smoke-process and close stdin.
		const sink = proc.stdin as unknown as { write: (b: Uint8Array) => number | Promise<number>; end: () => void };
		await sink.write(new Uint8Array(webm));
		sink.end();

		const stderrPromise = new Response(proc.stderr).text();
		const code = await proc.exited;
		const stderr = await stderrPromise;

		// ffmpeg should consume the WebM, transcode through libx264,
		// dump to /dev/null, and exit 0. Any non-zero is an arg-shape
		// regression we want to catch.
		if (code !== 0) {
			console.error("[smoke] ffmpeg exited", code);
			console.error("[smoke] stderr:", stderr.slice(-2000));
		}
		expect(code).toBe(0);
		// No "Unknown encoder" or similar fatal-args errors.
		expect(stderr).not.toMatch(/Unknown encoder|Unrecognized option/);
	}, 15_000);

	test("buildFfmpegArgs tee + null sinks: ffmpeg accepts the tee shape", async () => {
		// We can't tee to `-f null -` since tee needs URL-shaped slaves,
		// but we can verify ffmpeg parses the tee args by running with
		// `-dry-run`-equivalent: short input, expect "arg-valid" exit
		// behavior. We do this by setting both slaves to /dev/null files.
		const args = buildFfmpegArgs({
			encoder: { name: "libx264", extraArgs: ["-preset", "ultrafast"], label: "smoke" },
			targets: ["/tmp/wcl-smoke-a.flv", "/tmp/wcl-smoke-b.flv"],
			fps: 30,
			videoBitsPerSecond: 800_000,
		});
		// `-use_fifo 1` is a CLI flag (not in the teeArg string).
		expect(args).toContain("-use_fifo");
		// The teeArg is the muxer chain: contains both targets +
		// the per-slave format/flag block.
		const teeArg = args.at(-1)!;
		expect(teeArg).toContain("/tmp/wcl-smoke-a.flv");
		expect(teeArg).toContain("/tmp/wcl-smoke-b.flv");
		expect(teeArg).toContain("onfail=ignore");

		// Generate seed input and pipe through the real tee.
		const seedProc = Bun.spawn(
			[
				"ffmpeg",
				"-hide_banner",
				"-loglevel", "error",
				"-f", "lavfi",
				"-i", "testsrc=duration=0.3:size=160x120:rate=10",
				"-f", "lavfi",
				"-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
				"-c:v", "libvpx",
				"-c:a", "libopus",
				"-b:v", "80k",
				"-b:a", "32k",
				"-shortest",
				"-f", "webm",
				"-",
			],
			{ stdout: "pipe", stderr: "pipe", env: augmentedProcessEnv() },
		);
		const webm = await new Response(seedProc.stdout).arrayBuffer();
		await seedProc.exited;

		const proc = Bun.spawn(args, {
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
			env: augmentedProcessEnv(),
		});
		const sink = proc.stdin as unknown as { write: (b: Uint8Array) => number | Promise<number>; end: () => void };
		await sink.write(new Uint8Array(webm));
		sink.end();

		const stderrPromise = new Response(proc.stderr).text();
		const code = await proc.exited;
		const stderr = await stderrPromise;

		// Clean up output files (best-effort).
		for (const f of ["/tmp/wcl-smoke-a.flv", "/tmp/wcl-smoke-b.flv"]) {
			try { await Bun.file(f).unlink?.(); } catch { /* ignore */ }
			try { Bun.spawnSync(["rm", "-f", f]); } catch { /* ignore */ }
		}

		if (code !== 0) {
			console.error("[smoke-tee] ffmpeg exited", code);
			console.error("[smoke-tee] stderr:", stderr.slice(-2000));
		}
		expect(code).toBe(0);
		expect(stderr).not.toMatch(/Unknown encoder|Unrecognized option/);
	}, 15_000);
});
