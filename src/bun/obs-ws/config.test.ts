import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Redirect the userDataDir() that config.ts depends on by stubbing the
// HOME env var BEFORE the module loads. We re-import the module fresh
// in each test via dynamic import.

let originalHome: string | undefined;
let workDir: string;

beforeEach(async () => {
	originalHome = Bun.env["HOME"];
	workDir = await mkdtemp(join(tmpdir(), "wcl-obs-ws-config-"));
	// On macOS userDataDir prepends Library/Application Support/Weclank.
	// We can mimic the structure by writing into <workDir>/Library/...
	// Easier: use Linux-style HOME path and override XDG_CONFIG_HOME so
	// userDataDir lands directly in workDir.
	Bun.env["HOME"] = workDir;
	Bun.env["XDG_CONFIG_HOME"] = workDir;
	// On macOS we also need a fake "Library/Application Support" path
	// because userDataDir checks process.platform. We can't change
	// process.platform from inside the test, so we just create the dir.
	const macSupport = join(workDir, "Library", "Application Support", "Weclank");
	await Bun.write(`${macSupport}/.keep`, "");
});

afterEach(async () => {
	if (originalHome === undefined) delete Bun.env["HOME"];
	else Bun.env["HOME"] = originalHome;
	delete Bun.env["XDG_CONFIG_HOME"];
	await rm(workDir, { recursive: true, force: true });
});

describe("validateObsWsConfig", () => {
	test("disabled config passes any settings", async () => {
		const { validateObsWsConfig } = await import("./config");
		expect(() =>
			validateObsWsConfig({ enabled: false, port: 4455, hostname: "0.0.0.0" }),
		).not.toThrow();
	});

	test("loopback enabled without password is OK", async () => {
		const { validateObsWsConfig } = await import("./config");
		expect(() =>
			validateObsWsConfig({ enabled: true, port: 4455, hostname: "127.0.0.1" }),
		).not.toThrow();
		expect(() =>
			validateObsWsConfig({ enabled: true, port: 4455, hostname: "localhost" }),
		).not.toThrow();
	});

	test("LAN exposure without password throws", async () => {
		const { validateObsWsConfig } = await import("./config");
		expect(() =>
			validateObsWsConfig({ enabled: true, port: 4455, hostname: "0.0.0.0" }),
		).toThrow(/password/i);
		expect(() =>
			validateObsWsConfig({ enabled: true, port: 4455, hostname: "192.168.1.10" }),
		).toThrow(/password/i);
	});

	test("LAN exposure with password is OK", async () => {
		const { validateObsWsConfig } = await import("./config");
		expect(() =>
			validateObsWsConfig({
				enabled: true,
				port: 4455,
				hostname: "0.0.0.0",
				password: "secret",
			}),
		).not.toThrow();
	});

	test("out-of-range port throws", async () => {
		const { validateObsWsConfig } = await import("./config");
		expect(() =>
			validateObsWsConfig({ enabled: true, port: 0, hostname: "127.0.0.1" }),
		).toThrow(/port/i);
		expect(() =>
			validateObsWsConfig({ enabled: true, port: 70_000, hostname: "127.0.0.1" }),
		).toThrow(/port/i);
	});

	test("non-integer port throws", async () => {
		const { validateObsWsConfig } = await import("./config");
		expect(() =>
			validateObsWsConfig({ enabled: true, port: 4455.5, hostname: "127.0.0.1" }),
		).toThrow(/port/i);
	});
});

describe("readObsWsConfig / writeObsWsConfig", () => {
	test("readObsWsConfig returns defaults when file is absent", async () => {
		const { readObsWsConfig } = await import("./config");
		const cfg = await readObsWsConfig();
		expect(cfg.enabled).toBe(false);
		expect(cfg.port).toBe(4455);
		expect(cfg.hostname).toBe("127.0.0.1");
	});

	test("writeObsWsConfig persists, readObsWsConfig returns the persisted value", async () => {
		const { readObsWsConfig, writeObsWsConfig } = await import("./config");
		const next = await writeObsWsConfig({ enabled: true, port: 5555 });
		expect(next.enabled).toBe(true);
		expect(next.port).toBe(5555);
		const read = await readObsWsConfig();
		expect(read.enabled).toBe(true);
		expect(read.port).toBe(5555);
	});

	test("writeObsWsConfig merges patch with existing", async () => {
		const { readObsWsConfig, writeObsWsConfig } = await import("./config");
		await writeObsWsConfig({ enabled: true, port: 5555 });
		await writeObsWsConfig({ port: 6666 });
		const read = await readObsWsConfig();
		expect(read.enabled).toBe(true); // preserved
		expect(read.port).toBe(6666);    // updated
	});

	test("writeObsWsConfig refuses to persist invalid config", async () => {
		const { writeObsWsConfig, readObsWsConfig } = await import("./config");
		await expect(
			writeObsWsConfig({ enabled: true, hostname: "0.0.0.0" }),
		).rejects.toThrow(/password/i);
		// File should still be at defaults (not partially written).
		const read = await readObsWsConfig();
		expect(read.enabled).toBe(false);
	});
});
