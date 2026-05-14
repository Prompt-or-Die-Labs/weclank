import { describe, expect, test } from "bun:test";
import { recordingDateName, recordingFileName } from "./recording-names";

describe("recording names", () => {
	test("defaults to the local calendar date", () => {
		expect(recordingDateName(new Date(2026, 4, 14, 23, 30))).toBe("weclank-2026-05-14");
	});

	test("keeps a user-provided mp4 name", () => {
		expect(recordingFileName("launch-demo.mp4", "weclank-2026-05-14")).toBe("launch-demo.mp4");
	});

	test("sanitizes unsafe file names", () => {
		expect(recordingFileName("../bad:name?.webm", "weclank-2026-05-14")).toBe("bad-name.mp4");
	});

	test("uses fallback date name when the user leaves it blank", () => {
		expect(recordingFileName("   ", "weclank-2026-05-14")).toBe("weclank-2026-05-14.mp4");
	});
});
