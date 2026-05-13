import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isImageFileName, listMediaLibrary, sanitizeMediaCategory, safeMediaFileName } from "./media-library-files";

describe("media-library-files", () => {
	test("sanitizeMediaCategory blocks path segments", () => {
		expect(sanitizeMediaCategory("foo/bar")).toBe("foo-bar");
		expect(sanitizeMediaCategory("..hidden")).toBe("hidden");
		expect(sanitizeMediaCategory("   ")).toBe("Uncategorized");
	});

	test("safeMediaFileName strips directories", () => {
		expect(safeMediaFileName("/tmp/a.png")).toBe("a.png");
		expect(safeMediaFileName("x.png")).toBe("x.png");
	});

	test("isImageFileName", () => {
		expect(isImageFileName("a.PNG")).toBe(true);
		expect(isImageFileName("x.webp")).toBe(true);
		expect(isImageFileName("nope.txt")).toBe(false);
	});

	test("listMediaLibrary returns empty categories only for missing category folders", async () => {
		const root = await mkdtemp(join(tmpdir(), "weclank-media-"));
		await writeFile(join(root, "not-a-directory"), "nope");

		const missing = await listMediaLibrary({ rootPath: root, categories: ["Uploads"] });
		expect(missing).toEqual({ ok: true, categories: [{ name: "Uploads", files: [] }] });

		const blocked = await listMediaLibrary({ rootPath: root, categories: ["not-a-directory"] });
		expect(blocked.ok).toBe(false);
		if (!blocked.ok) expect(blocked.error.length).toBeGreaterThan(0);
	});

	test("listMediaLibrary rejects an empty root", async () => {
		const result = await listMediaLibrary({ rootPath: "   ", categories: ["Uploads"] });
		expect(result).toEqual({ ok: false, error: "Media library root is required" });
	});
});
