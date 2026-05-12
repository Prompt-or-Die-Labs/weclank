import { describe, expect, test } from "bun:test";
import { PRESETS, pickSupportedMime } from "./presets";

describe("PRESETS", () => {
	test("each tier has a sensible resolution, fps, and codec", () => {
		for (const tier of ["480p", "720p", "1080p"] as const) {
			const p = PRESETS[tier];
			expect(p.width).toBeGreaterThan(640);
			expect(p.height).toBeGreaterThan(360);
			expect(p.fps).toBeGreaterThanOrEqual(24);
			expect(p.fps).toBeLessThanOrEqual(60);
			expect(p.videoBitsPerSecond).toBeGreaterThan(500_000);
			expect(p.mimeType).toMatch(/^video\/webm/);
		}
	});

	test("resolutions scale up as the tier increases", () => {
		expect(PRESETS["480p"].width).toBeLessThan(PRESETS["720p"].width);
		expect(PRESETS["720p"].width).toBeLessThan(PRESETS["1080p"].width);
	});

	test("VP8 used for 480p and 720p; VP9 reserved for 1080p", () => {
		expect(PRESETS["480p"].mimeType).toMatch(/vp8/);
		expect(PRESETS["720p"].mimeType).toMatch(/vp8/);
		expect(PRESETS["1080p"].mimeType).toMatch(/vp9/);
	});

	test("pickSupportedMime falls back when the preferred MIME isn't supported", () => {
		// Bun's runtime doesn't ship MediaRecorder; we stub it for this test.
		const original = (globalThis as { MediaRecorder?: { isTypeSupported(t: string): boolean } }).MediaRecorder;
		(globalThis as unknown as { MediaRecorder: { isTypeSupported(t: string): boolean } }).MediaRecorder = {
			isTypeSupported: (t: string): boolean => t === "video/webm; codecs=vp8,opus",
		};
		try {
			expect(pickSupportedMime("video/webm; codecs=vp9,opus")).toBe("video/webm; codecs=vp8,opus");
		} finally {
			if (original) {
				(globalThis as unknown as { MediaRecorder: typeof original }).MediaRecorder = original;
			} else {
				delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
			}
		}
	});

	test("pickSupportedMime returns the preferred MIME when supported", () => {
		(globalThis as unknown as { MediaRecorder: { isTypeSupported(t: string): boolean } }).MediaRecorder = {
			isTypeSupported: (): boolean => true,
		};
		try {
			expect(pickSupportedMime("video/webm; codecs=vp9,opus")).toBe("video/webm; codecs=vp9,opus");
		} finally {
			delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
		}
	});
});
