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
	document.querySelector<HTMLButtonElement>(".modal__close")?.click();
	const root = document.querySelector<HTMLElement>("#overlay-root");
	root?.replaceChildren();
	for (const child of Array.from(document.body.children)) {
		if (child !== root) child.remove();
	}
});

async function flush(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("recording review dialog", () => {
	test("shows vertical export controls and previews exported clips", async () => {
		const { openRecordingReviewDialog } = await import("./recording-review-dialog");
		openRecordingReviewDialog("/tmp/source.mp4");

		expect(document.querySelector("#overlay-root")).not.toBeNull();
		expect(document.body.textContent).toContain("Timeline");
		expect(document.querySelector<HTMLSelectElement>(".recording-review__short select")?.value).toBe("tiktok");
		expect(document.body.textContent).toContain("Export vertical short");

		const endInput = document.querySelector<HTMLInputElement>('[id$="-t1"]')!;
		endInput.value = "30";
		endInput.dispatchEvent(new Event("input", { bubbles: true }));
		document.querySelector<HTMLButtonElement>('[id$="-short"]')?.click();
		await flush();
		await flush();

		expect(document.body.textContent).toContain("TIKTOK short");
		expect(document.querySelector<HTMLVideoElement>(".recording-review__export-preview video")?.src).toContain("weclank-short-tiktok.mp4");
	});

	test("adds timeline clips and exports them from the clip queue", async () => {
		const { openRecordingReviewDialog } = await import("./recording-review-dialog");
		openRecordingReviewDialog("/tmp/source.mp4");

		const endInput = document.querySelector<HTMLInputElement>('[id$="-t1"]')!;
		endInput.value = "30";
		endInput.dispatchEvent(new Event("input", { bubbles: true }));

		document.querySelector<HTMLButtonElement>('[id$="-add-clip"]')?.click();
		expect(document.querySelectorAll(".recording-review__clip").length).toBe(1);
		expect(document.body.textContent).toContain("Clip 1");
		expect(document.body.textContent).toContain("0:00 to 0:30");

		document.querySelector<HTMLButtonElement>('[data-clip-action="trim"]')?.click();
		await flush();
		await flush();
		expect(document.body.textContent).toContain("Clip 1 MP4");
		expect(document.querySelector<HTMLVideoElement>(".recording-review__export-preview video")?.src).toContain("weclank-trim.mp4");

		document.querySelector<HTMLButtonElement>('[data-clip-action="short"]')?.click();
		await flush();
		await flush();
		expect(document.body.textContent).toContain("Clip 1 TIKTOK short");
		expect(document.querySelector<HTMLVideoElement>(".recording-review__export-preview video")?.src).toContain("weclank-short-tiktok.mp4");
	});
});
