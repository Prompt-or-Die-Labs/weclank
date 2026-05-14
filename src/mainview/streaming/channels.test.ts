// Channels logic — platform detection, multi-channel resolution, and the
// "broadcast to all" back-compat when no selection is active.

import { describe, expect, test } from "bun:test";
import { detectPlatform, filterActiveChannels, PLATFORM_HINTS, PLATFORM_RTMP_PREFIX } from "./channels";
import type { PlatformId, RtmpChannel } from "../core/types";
import { buildFfmpegArgs } from "../../bun/egress";

const PLATFORMS: PlatformId[] = [
	"twitch", "youtube", "facebook", "rumble",
	"x", "kick", "tiktok", "instagram", "linkedin", "custom",
];

function ch(overrides: Partial<RtmpChannel> & { id: string; platform: PlatformId }): RtmpChannel {
	return {
		label: overrides.label ?? overrides.platform,
		rtmpUrl: overrides.rtmpUrl ?? `rtmp://example/${overrides.platform}`,
		streamKey: overrides.streamKey ?? "key",
		...overrides,
	};
}

describe("detectPlatform", () => {
	test("identifies each well-known platform from URL", () => {
		expect(detectPlatform("rtmp://live.twitch.tv/app")).toBe("twitch");
		expect(detectPlatform("rtmp://a.rtmp.youtube.com/live2")).toBe("youtube");
		expect(detectPlatform("rtmps://live-api-s.facebook.com:443/rtmp/")).toBe("facebook");
		expect(detectPlatform("rtmp://live.rumble.com/live/")).toBe("rumble");
		expect(detectPlatform("rtmp://global-live.twitter.com:443/app")).toBe("x");
		expect(detectPlatform("rtmps://random.live-video.net/app/")).toBe("kick");
		expect(detectPlatform("rtmp://push-rtmp-l1-mvb.tiktokcdn.com/abc")).toBe("tiktok");
		expect(detectPlatform("rtmps://live-upload.instagram.com/rtmp/")).toBe("instagram");
		expect(detectPlatform("rtmps://1234.linkedin.com/live")).toBe("linkedin");
	});

	test("falls back to custom for unknown hosts", () => {
		expect(detectPlatform("rtmp://my-own-server.example.com/live")).toBe("custom");
		expect(detectPlatform("")).toBe("custom");
	});

	test("is case-insensitive", () => {
		expect(detectPlatform("RTMP://LIVE.TWITCH.TV/APP")).toBe("twitch");
	});
});

describe("platform metadata", () => {
	test("every PlatformId has a hint string", () => {
		for (const p of PLATFORMS) {
			expect(PLATFORM_HINTS[p]).toBeTruthy();
			expect(PLATFORM_HINTS[p].length).toBeGreaterThan(10);
		}
	});

	test("every PlatformId has a (possibly-empty) prefix entry", () => {
		for (const p of PLATFORMS) {
			expect(PLATFORM_RTMP_PREFIX[p]).toBeDefined();
		}
	});

	test("platforms with static endpoints prefill an rtmp:// URL", () => {
		// These are the ones a streamer can use right away by just pasting
		// their stream key — no per-user URL lookup required.
		const staticPlatforms: PlatformId[] = ["twitch", "youtube", "facebook", "rumble", "x"];
		for (const p of staticPlatforms) {
			expect(PLATFORM_RTMP_PREFIX[p]).toMatch(/^rtmps?:\/\//);
		}
	});

	test("gated platforms leave the URL blank (user pastes their own)", () => {
		// These require per-user URLs from the platform's dashboard
		// (or partner/approval status). The hint tells them where to find it.
		const gatedPlatforms: PlatformId[] = ["kick", "tiktok", "instagram", "linkedin", "custom"];
		for (const p of gatedPlatforms) {
			expect(PLATFORM_RTMP_PREFIX[p]).toBe("");
		}
	});
});

describe("filterActiveChannels", () => {
	const channels: RtmpChannel[] = [
		ch({ id: "ch-1", platform: "twitch" }),
		ch({ id: "ch-2", platform: "youtube" }),
		ch({ id: "ch-3", platform: "x" }),
	];

	test("empty active selection broadcasts to every saved channel", () => {
		// Back-compat: pre-channels users had a flat "destinations" list
		// that always fanned out. New users with no manual toggles see
		// the same behaviour.
		expect(filterActiveChannels(channels, [])).toEqual(channels);
		expect(filterActiveChannels(channels, undefined)).toEqual(channels);
	});

	test("selecting one channel returns just that one", () => {
		const onlyTwitch = filterActiveChannels(channels, ["ch-1"]);
		expect(onlyTwitch).toHaveLength(1);
		expect(onlyTwitch[0]!.platform).toBe("twitch");
	});

	test("selecting multiple channels returns each in saved order", () => {
		// Streamer wants Twitch + X simultaneously — the goal scenario.
		const twitchAndX = filterActiveChannels(channels, ["ch-1", "ch-3"]);
		expect(twitchAndX).toHaveLength(2);
		expect(twitchAndX.map((c) => c.platform)).toEqual(["twitch", "x"]);
	});

	test("unknown ids in the active list are ignored", () => {
		const result = filterActiveChannels(channels, ["ch-1", "ch-deleted"]);
		expect(result).toHaveLength(1);
		expect(result[0]!.id).toBe("ch-1");
	});

	test("active list including every id is the same as broadcast-to-all", () => {
		const allIds = channels.map((c) => c.id);
		expect(filterActiveChannels(channels, allIds)).toEqual(channels);
	});
});

describe("multi-destination egress pipeline (Twitch + X simultaneously)", () => {
	// Wires `filterActiveChannels` together with the Bun-side ffmpeg
	// argument builder to lock in the end-to-end goal: a streamer picking
	// Twitch + X in the header strip produces a single ffmpeg invocation
	// using the tee muxer to fan out to both endpoints.
	const channels: RtmpChannel[] = [
		ch({ id: "twitch-1", platform: "twitch", rtmpUrl: "rtmp://live.twitch.tv/app", streamKey: "twkey" }),
		ch({ id: "youtube-1", platform: "youtube", rtmpUrl: "rtmp://a.rtmp.youtube.com/live2", streamKey: "ytkey" }),
		ch({ id: "x-1", platform: "x", rtmpUrl: "rtmp://global-live.twitter.com:443/app", streamKey: "xkey" }),
	];

	test("picks the right channels and builds a tee-muxer ffmpeg command", () => {
		const targets = filterActiveChannels(channels, ["twitch-1", "x-1"]);
		expect(targets.map((c) => c.platform)).toEqual(["twitch", "x"]);

		// What AppHeader.startEgress sends to Bun:
		const destinations = targets.map((c) => `${c.rtmpUrl}/${c.streamKey}`);
		const args = buildFfmpegArgs({ name: "libx264", extraArgs: [], label: "x264" }, destinations);

		expect(args).toContain("tee");
		expect(args.at(-1)).toBe(
			"[f=flv]rtmp://live.twitch.tv/app/twkey|[f=flv]rtmp://global-live.twitter.com:443/app/xkey",
		);
	});

	test("single-channel selection skips the tee muxer", () => {
		const targets = filterActiveChannels(channels, ["twitch-1"]);
		const destinations = targets.map((c) => `${c.rtmpUrl}/${c.streamKey}`);
		const args = buildFfmpegArgs({ name: "libx264", extraArgs: [], label: "x264" }, destinations);

		expect(args).not.toContain("tee");
		expect(args.at(-1)).toBe("rtmp://live.twitch.tv/app/twkey");
	});

	test("three-channel selection fans out to all three", () => {
		const targets = filterActiveChannels(channels, ["twitch-1", "youtube-1", "x-1"]);
		const destinations = targets.map((c) => `${c.rtmpUrl}/${c.streamKey}`);
		const args = buildFfmpegArgs({ name: "libx264", extraArgs: [], label: "x264" }, destinations);

		expect(args).toContain("tee");
		const teeArg = args.at(-1)!;
		expect(teeArg).toContain("rtmp://live.twitch.tv/app/twkey");
		expect(teeArg).toContain("rtmp://a.rtmp.youtube.com/live2/ytkey");
		expect(teeArg).toContain("rtmp://global-live.twitter.com:443/app/xkey");
		expect(teeArg.split("|")).toHaveLength(3);
	});
});
