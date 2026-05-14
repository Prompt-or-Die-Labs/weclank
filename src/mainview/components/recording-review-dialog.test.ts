import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";

beforeAll(() => {
	mock.module("../rpc", () => ({
		bunRpc: {
			registerRecordingPreview: async ({ path }: { path: string }) => ({
				ok: true,
				url: `http://127.0.0.1/preview/${encodeURIComponent(path)}`,
				token: `token-${path}`,
			}),
			unregisterRecordingPreview: async () => ({ ok: true }),
			saveRecordingTrimmed: async () => ({ ok: true, path: "/tmp/weclank-trim.mp4" }),
			saveRecordingShortExport: async () => ({ ok: true, path: "/tmp/weclank-short-tiktok.mp4" }),
			deleteRecordingFile: async () => ({ ok: true }),
		},
	}));
});

afterEach(() => {
	document.body.innerHTML = "";
});

describe("recording review dialog", () => {
	test("shows vertical export controls and previews exported clips", async () => {
		const { openRecordingReviewDialog } = await import("./recording-review-dialog");
		openRecordingReviewDialog("/tmp/source.mp4");

		expect(document.querySelector("#overlay-root")).not.toBeNull();
		expect(document.querySelector<HTMLSelectElement>(".recording-review__short select")?.value).toBe("tiktok");
		expect(document.body.textContent).toContain("Export vertical short");

		const endInput = document.querySelector<HTMLInputElement>('[id$="-t1"]')!;
		endInput.value = "30";
		document.querySelector<HTMLButtonElement>('[id$="-short"]')?.click();
		await new Promise((resolve) => setTimeout(resolve, 0));
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(document.body.textContent).toContain("TIKTOK short");
		expect(document.querySelector<HTMLVideoElement>(".recording-review__export-preview video")?.src).toContain("weclank-short-tiktok.mp4");
	});
});
