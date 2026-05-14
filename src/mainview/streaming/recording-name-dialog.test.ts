import { afterEach, describe, expect, test } from "bun:test";
import { pickRecordingFileName } from "./recording-name-dialog";

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

describe("recording name dialog", () => {
	test("uses the default date name when submitted unchanged", async () => {
		const picked = pickRecordingFileName("weclank-2026-05-14");
		await flush();

		document.querySelector<HTMLFormElement>(".recording-name")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

		await expect(picked).resolves.toBe("weclank-2026-05-14.mp4");
	});

	test("returns a user-provided name", async () => {
		const picked = pickRecordingFileName("weclank-2026-05-14");
		await flush();
		const input = document.querySelector<HTMLInputElement>(".recording-name input")!;
		input.value = "launch clip";

		document.querySelector<HTMLFormElement>(".recording-name")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

		await expect(picked).resolves.toBe("launch clip.mp4");
	});

	test("returns null when canceled", async () => {
		const picked = pickRecordingFileName("weclank-2026-05-14");
		await flush();

		document.querySelector<HTMLButtonElement>('[data-action="cancel"]')?.click();

		await expect(picked).resolves.toBeNull();
	});
});
