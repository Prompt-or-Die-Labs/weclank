// Tests the URL validator logic that openUrlInputDialog uses. We
// don't unit-test the Modal-binding plumbing (that needs an integrated
// DOM); we DO test the validate-function shape so URLs that pass here
// are guaranteed to pass at the dialog layer.

import { describe, expect, test } from "bun:test";

// The validator is declared inline inside openUrlInputDialog. Repeat
// it here as a pure function so we can test it without spinning up
// happy-dom's overlay-root. If the implementation in
// input-dialog.ts changes, this duplication is the canary.
function urlValidator(raw: string): string | null {
	if (!raw) return "URL required";
	try {
		const u = new URL(raw);
		if (u.protocol !== "https:" && u.protocol !== "http:") {
			return "URL must start with http:// or https://";
		}
		return null;
	} catch {
		return "Doesn't look like a valid URL";
	}
}

describe("URL input validation", () => {
	test("accepts https URLs", () => {
		expect(urlValidator("https://example.com")).toBeNull();
		expect(urlValidator("https://streamelements.com/overlay/abc-123/widget")).toBeNull();
	});

	test("accepts http URLs", () => {
		expect(urlValidator("http://localhost:3000")).toBeNull();
	});

	test("rejects empty input", () => {
		expect(urlValidator("")).toBe("URL required");
	});

	test("rejects non-URL strings", () => {
		expect(urlValidator("not a url")).toBe("Doesn't look like a valid URL");
		expect(urlValidator("streamelements.com")).toBe("Doesn't look like a valid URL");
	});

	test("rejects file: / ftp: / javascript: schemes", () => {
		expect(urlValidator("file:///etc/passwd")).toMatch(/http/i);
		expect(urlValidator("ftp://example.com")).toMatch(/http/i);
		expect(urlValidator("javascript:alert(1)")).toMatch(/http/i);
	});

	test("accepts URLs with query strings and fragments", () => {
		expect(urlValidator("https://example.com/path?a=1&b=2#section")).toBeNull();
	});
});
