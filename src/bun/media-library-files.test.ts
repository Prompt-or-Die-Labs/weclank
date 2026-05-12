import { describe, expect, test } from "bun:test";
import { isImageFileName, sanitizeMediaCategory, safeMediaFileName } from "./media-library-files";

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
});
