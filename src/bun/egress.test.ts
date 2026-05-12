import { describe, expect, test } from "bun:test";
import { buildFfmpegArgs, buildRtmpUrl, parseFfmpegProgressLine } from "./egress";

describe("Bun egress helpers", () => {
	test("builds RTMP URLs with stream keys", () => {
		expect(buildRtmpUrl("rtmp://live.twitch.tv/app/", "abc")).toBe("rtmp://live.twitch.tv/app/abc");
		expect(buildRtmpUrl("rtmps://example/live/key", "abc")).toBe("rtmps://example/live/key/abc");
		expect(buildRtmpUrl("rtmp://example/live?token=x", "abc")).toBe("rtmp://example/live?token=x/abc");
	});

	test("parses ffmpeg progress fields", () => {
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

	test("uses tee muxer for multiple targets", () => {
		const args = buildFfmpegArgs({ name: "libx264", extraArgs: ["-preset", "veryfast"], label: "x264" }, [
			"rtmp://a/live/key",
			"rtmp://b/live/key",
		]);

		expect(args).toContain("tee");
		expect(args.at(-1)).toBe("[f=flv]rtmp://a/live/key|[f=flv]rtmp://b/live/key");
	});
});
