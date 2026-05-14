import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { uniqueRecordingOutputPath } from "./recording-file-path";

describe("recording file paths", () => {
	test("uses the requested file name when it is available", async () => {
		const root = await mkdtemp(join(tmpdir(), "weclank-rec-path-"));

		await expect(uniqueRecordingOutputPath(root, "weclank-2026-05-14.mp4")).resolves.toBe(join(root, "weclank-2026-05-14.mp4"));
	});

	test("adds a suffix instead of overwriting an existing recording", async () => {
		const root = await mkdtemp(join(tmpdir(), "weclank-rec-path-"));
		await writeFile(join(root, "weclank-2026-05-14.mp4"), "old");

		await expect(uniqueRecordingOutputPath(root, "weclank-2026-05-14.mp4")).resolves.toBe(join(root, "weclank-2026-05-14-2.mp4"));
	});
});
