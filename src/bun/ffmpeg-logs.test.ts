import { describe, expect, test } from "bun:test";
import { ffmpegLogPath, ffreportEnvValue } from "./ffmpeg-logs";

describe("ffmpegLogPath", () => {
	test("produces a path under the user data dir's logs/", () => {
		const p = ffmpegLogPath("egress-2dst", 1700000000000);
		expect(p).toMatch(/\/logs\/egress-2dst-2023-11-14T22-13-20-000Z\.log$/);
	});

	test("sanitises labels — slashes and colons replaced with underscores", () => {
		const p = ffmpegLogPath("evil/label:with:colons", 0);
		expect(p).toMatch(/evil_label_with_colons-/);
	});

	test("clamps label length to 24 chars", () => {
		const p = ffmpegLogPath("a".repeat(50), 0);
		const filename = p.split("/").pop()!;
		// 24 a's + "-<iso>" timestamp portion + ".log" — the safe portion should be exactly 24.
		const safe = filename.split("-")[0]!;
		expect(safe.length).toBe(24);
	});

	test("empty label falls back to 'egress'", () => {
		const p = ffmpegLogPath("!@#$%^&*()", 0);
		const filename = p.split("/").pop()!;
		expect(filename.startsWith("egress-")).toBe(true);
	});
});

describe("ffreportEnvValue", () => {
	test("escapes colons in the path", () => {
		const v = ffreportEnvValue("/a/b/file:2024-01-01.log");
		expect(v).toBe("file=/a/b/file\\:2024-01-01.log:level=32");
	});

	test("normalises Windows backslashes to forward slashes", () => {
		const v = ffreportEnvValue("C:\\Users\\Foo\\file.log");
		expect(v).toBe("file=C\\:/Users/Foo/file.log:level=32");
	});

	test("emits level=32 (info+warn+error)", () => {
		const v = ffreportEnvValue("/x.log");
		expect(v.endsWith(":level=32")).toBe(true);
	});
});
