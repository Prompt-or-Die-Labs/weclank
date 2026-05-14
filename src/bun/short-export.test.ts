import { describe, expect, test } from "bun:test";
import { buildShortExportArgs, getShortExportPreset } from "./short-export";

describe("short export presets", () => {
	test("builds 9:16 ffmpeg args for platform shorts", () => {
		const args = buildShortExportArgs({
			inputPath: "/tmp/in.mp4",
			outputPath: "/tmp/out.mp4",
			presetId: "tiktok",
			startSec: 3,
			durationSec: 42,
		});

		expect(args).toContain("scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1");
		expect(args).toContain("-maxrate");
		expect(args).toContain("10M");
		expect(args).toContain("20M");
		expect(args.at(-1)).toBe("/tmp/out.mp4");
	});

	test("rejects unknown preset ids", () => {
		expect(getShortExportPreset("reels")?.label).toBe("Reels");
		expect(getShortExportPreset("unknown")).toBeNull();
	});
});
