import { afterEach, describe, expect, test } from "bun:test";
import { pickRecordingSourceKind } from "./recording-source-dialog";

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

describe("recording source dialog", () => {
	test("returns screen capture by default action", async () => {
		const picked = pickRecordingSourceKind();
		await flush();

		document.querySelector<HTMLButtonElement>('[data-kind="screen"]')?.click();

		await expect(picked).resolves.toBe("screen");
	});

	test("returns webcam when selected", async () => {
		const picked = pickRecordingSourceKind();
		await flush();

		document.querySelector<HTMLButtonElement>('[data-kind="camera"]')?.click();

		await expect(picked).resolves.toBe("camera");
	});

	test("returns null when canceled", async () => {
		const picked = pickRecordingSourceKind();
		await flush();

		document.querySelector<HTMLButtonElement>('[data-action="cancel"]')?.click();

		await expect(picked).resolves.toBeNull();
	});
});
