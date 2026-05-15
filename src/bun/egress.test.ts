import { describe, expect, test } from "bun:test";
import { buildFfmpegArgs, buildRtmpUrl, parseFfmpegProgressKv, parseFfmpegProgressLine } from "./egress";

const x264: { name: string; extraArgs: string[]; label: string } = {
	name: "libx264",
	extraArgs: ["-preset", "veryfast"],
	label: "x264",
};

const HD: { fps: number; videoBitsPerSecond: number; audioBitsPerSecond: number } = {
	fps: 30,
	videoBitsPerSecond: 2_500_000,
	audioBitsPerSecond: 128_000,
};

describe("buildRtmpUrl", () => {
	test("appends stream keys to base URLs", () => {
		expect(buildRtmpUrl("rtmp://live.twitch.tv/app/", "abc")).toBe("rtmp://live.twitch.tv/app/abc");
		expect(buildRtmpUrl("rtmps://example/live/key", "abc")).toBe("rtmps://example/live/key/abc");
		expect(buildRtmpUrl("rtmp://example/live?token=x", "abc")).toBe("rtmp://example/live?token=x/abc");
	});
});

describe("parseFfmpegProgressLine (legacy stderr-regex parser)", () => {
	test("parses the human-readable stderr line", () => {
		const parsed = parseFfmpegProgressLine(
			{},
			"frame= 240 fps= 30 q=23.0 size=2048kB time=00:00:08.50 bitrate=2048.0kbits/s speed=1.25x drop=2",
			123,
		);
		expect(parsed).toEqual({
			fps: 30,
			bitrateKbps: 2048,
			droppedFrames: 2,
			timeSeconds: 8.5,
			speed: 1.25,
			updatedAt: 123,
		});
	});
});

describe("parseFfmpegProgressKv (-progress pipe:1 key=value)", () => {
	test("flushes stats on progress=continue", () => {
		const block = [
			"frame=240",
			"fps=30.00",
			"bitrate=2048.0kbits/s",
			"total_size=2097152",
			"out_time_us=8500000",
			"out_time=00:00:08.500000",
			"dup_frames=0",
			"drop_frames=2",
			"speed=1.25x",
			"progress=continue",
		];
		const parsed = parseFfmpegProgressKv({}, block, 123);
		expect(parsed).toEqual({
			fps: 30,
			bitrateKbps: 2048,
			droppedFrames: 2,
			timeSeconds: 8.5,
			speed: 1.25,
			updatedAt: 123,
		});
	});

	test("ignores partial blocks (no progress= terminator → no updatedAt)", () => {
		const partial = ["fps=29.97", "bitrate=2000.0kbits/s"];
		const parsed = parseFfmpegProgressKv({}, partial, 999);
		expect(parsed.fps).toBe(29.97);
		expect(parsed.bitrateKbps).toBe(2000);
		expect(parsed.updatedAt).toBeUndefined();
	});

	test("handles N/A speed/bitrate gracefully", () => {
		const block = [
			"fps=0",
			"bitrate=N/A",
			"speed=N/A",
			"out_time_us=0",
			"drop_frames=0",
			"progress=continue",
		];
		const prev = { bitrateKbps: 999, speed: 1 };
		const parsed = parseFfmpegProgressKv(prev, block, 1);
		// fps and out_time_us update; bitrate/speed keep the old value because N/A doesn't match.
		expect(parsed.fps).toBe(0);
		expect(parsed.bitrateKbps).toBe(999);
		expect(parsed.speed).toBe(1);
		expect(parsed.droppedFrames).toBe(0);
		expect(parsed.timeSeconds).toBe(0);
	});

	test("falls back to out_time when out_time_us missing", () => {
		const block = [
			"fps=30",
			"out_time=00:01:30.250000",
			"progress=continue",
		];
		const parsed = parseFfmpegProgressKv({}, block, 1);
		expect(parsed.timeSeconds).toBe(90.25);
	});
});

describe("buildFfmpegArgs — single destination", () => {
	const args = buildFfmpegArgs({
		encoder: x264,
		targets: ["rtmp://live.twitch.tv/app/key"],
		...HD,
	});

	test("uses -f flv (canonical RTMP container)", () => {
		const fIdx = args.lastIndexOf("-f");
		expect(args[fIdx + 1]).toBe("flv");
		expect(args.at(-1)).toBe("rtmp://live.twitch.tv/app/key");
	});

	test("does NOT use tee muxer for single destination", () => {
		expect(args).not.toContain("tee");
		expect(args).not.toContain("-use_fifo");
	});

	test("emits non-seekable FLV flags", () => {
		expect(args).toContain("-flvflags");
		const i = args.indexOf("-flvflags");
		expect(args[i + 1]).toBe("+no_duration_filesize");
	});

	test("threads bitrate to -b:v / -maxrate / -bufsize", () => {
		const bi = args.indexOf("-b:v");
		expect(args[bi + 1]).toBe("2500000");
		const mi = args.indexOf("-maxrate");
		expect(args[mi + 1]).toBe("2500000");
		const bsi = args.indexOf("-bufsize");
		expect(args[bsi + 1]).toBe("5000000");
	});

	test("derives GOP from fps (2*fps with keyint_min pinned)", () => {
		const gi = args.indexOf("-g");
		expect(args[gi + 1]).toBe("60"); // 30fps * 2
		const ki = args.indexOf("-keyint_min");
		expect(args[ki + 1]).toBe("60");
		expect(args).toContain("-sc_threshold");
		expect(args).toContain("-force_key_frames");
	});

	test("includes -progress pipe:1 -nostats", () => {
		expect(args).toContain("-progress");
		const pi = args.indexOf("-progress");
		expect(args[pi + 1]).toBe("pipe:1");
		expect(args).toContain("-nostats");
	});

	test("includes low-latency input flags (smoke-test-validated set)", () => {
		// Note: `+nobuffer` was tested via real ffmpeg + real MediaRecorder
		// output and removed — it skips the input-stream analysis where the
		// VP8 keyframe lives, causing ffmpeg to exit 69. The remaining set
		// is verified by src/bun/egress-smoke.test.ts.
		expect(args).toContain("-fflags");
		expect(args).toContain("+genpts");
		expect(args).toContain("-flags");
		expect(args).toContain("+low_delay");
		expect(args).toContain("-thread_queue_size");
	});

	test("audio bitrate in kbps form", () => {
		expect(args).toContain("-b:a");
		const bi = args.indexOf("-b:a");
		expect(args[bi + 1]).toBe("128k");
	});

	test("audio bitrate defaults to 128k if not provided", () => {
		const args2 = buildFfmpegArgs({
			encoder: x264,
			targets: ["rtmp://a/key"],
			fps: 24,
			videoBitsPerSecond: 1_000_000,
		});
		const bi = args2.indexOf("-b:a");
		expect(args2[bi + 1]).toBe("128k");
	});

	test("GOP recomputes for non-30fps presets", () => {
		const args24 = buildFfmpegArgs({
			encoder: x264,
			targets: ["rtmp://a/key"],
			fps: 24,
			videoBitsPerSecond: 1_200_000,
		});
		const gi = args24.indexOf("-g");
		expect(args24[gi + 1]).toBe("48"); // 24fps * 2

		const args60 = buildFfmpegArgs({
			encoder: x264,
			targets: ["rtmp://a/key"],
			fps: 60,
			videoBitsPerSecond: 6_000_000,
		});
		const gi60 = args60.indexOf("-g");
		expect(args60[gi60 + 1]).toBe("120"); // 60fps * 2
	});
});

describe("buildFfmpegArgs — tee multi-destination", () => {
	const args = buildFfmpegArgs({
		encoder: x264,
		targets: ["rtmp://a/live/key", "rtmp://b/live/key"],
		...HD,
	});

	test("uses tee muxer", () => {
		expect(args).toContain("tee");
	});

	test("enables fifo for parallel slave processing (audit P1 #3)", () => {
		expect(args).toContain("-use_fifo");
		const i = args.indexOf("-use_fifo");
		expect(args[i + 1]).toBe("1");
	});

	test("declares global_header (required by tee docs)", () => {
		// CLI-level -flags before the tee muxer (not the input-side
		// -flags +low_delay we set earlier).
		// We grep all -flags occurrences for +global_header.
		const ok = args.some((arg, i) => arg === "-flags" && args[i + 1] === "+global_header");
		expect(ok).toBe(true);
	});

	test("emits onfail=ignore + no_duration_filesize per slave", () => {
		const teeArg = args.at(-1)!;
		expect(teeArg).toContain("f=flv");
		expect(teeArg).toContain("flvflags=+no_duration_filesize");
		expect(teeArg).toContain("onfail=ignore");
		expect(teeArg).toContain("rtmp://a/live/key");
		expect(teeArg).toContain("rtmp://b/live/key");
	});

	test("targets are separated by | (the tee delimiter)", () => {
		const teeArg = args.at(-1)!;
		expect(teeArg.split("|")).toHaveLength(2);
	});
});
