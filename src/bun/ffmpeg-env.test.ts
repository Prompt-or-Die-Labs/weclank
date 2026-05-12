import { describe, expect, it } from "bun:test";
import { buildPathForFfmpeg } from "./ffmpeg-env";

describe("buildPathForFfmpeg", () => {
	it("prepends Homebrew Apple Silicon bin on macOS", () => {
		const p = buildPathForFfmpeg("darwin", "/usr/bin:/bin");
		expect(p.startsWith("/opt/homebrew/bin:")).toBe(true);
		expect(p).toContain("/usr/bin");
		expect(p).toContain("/bin");
	});

	it("keeps Homebrew first when PATH already starts with it", () => {
		const p = buildPathForFfmpeg("darwin", "/opt/homebrew/bin:/usr/bin");
		expect(p.startsWith("/opt/homebrew/bin:")).toBe(true);
		expect(p.split(":").filter((x) => x === "/opt/homebrew/bin").length).toBeGreaterThanOrEqual(1);
		expect(p).toContain("/usr/bin");
	});

	it("prepends Linuxbrew then keeps existing", () => {
		const p = buildPathForFfmpeg("linux", "/usr/bin");
		expect(p.startsWith("/home/linuxbrew/.linuxbrew/bin:")).toBe(true);
		expect(p).toContain("/usr/bin");
	});

	it("uses semicolon separator on win32", () => {
		const p = buildPathForFfmpeg("win32", "C:\\Windows\\System32");
		expect(p).toContain(";");
		expect(p.toLowerCase()).toContain("chocolatey");
		expect(p).toContain("System32");
	});
});
