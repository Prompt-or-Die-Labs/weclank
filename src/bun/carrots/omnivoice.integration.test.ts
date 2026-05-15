// End-to-end smoke for the OmniVoice carrot bundle.
//
// `status` always works (it just reports what's on disk). `prepare` + the
// real `synthesize` run only when WECLANK_OMNIVOICE_E2E=1 is set in env —
// they download ~660MB and need the llama-omnivoice-server binary to be
// built (`bun run build:omnivoice`). Skipping is cheap; we don't want CI
// or a fresh clone to silently hang on first run.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { resetDbForTesting, setDbForTesting } from "../db/schema";
import { installFromDir, setEnabled, uninstall } from "./store";
import { carrotHost } from "./host";

const CARROT_DIR = join(import.meta.dir, "..", "..", "..", "carrots", "omnivoice");
const RUN_E2E = process.env["WECLANK_OMNIVOICE_E2E"] === "1";

beforeEach(() => {
	setDbForTesting(new Database(":memory:"));
});

afterEach(async () => {
	await carrotHost.stopAll();
	resetDbForTesting();
});

describe("omnivoice carrot integration", () => {
	test("install → enable → status invoke → uninstall", async () => {
		const install = await installFromDir({
			sourcePath: CARROT_DIR,
			granted: { bun: { read: true, run: true, env: true } },
		});
		expect(install.carrot.id).toBe("omnivoice");

		await setEnabled("omnivoice", true);
		await carrotHost.start("omnivoice");
		expect(carrotHost.isRunning("omnivoice")).toBe(true);

		const status = (await carrotHost.invoke("omnivoice", "status", {})) as {
			binary: string;
			model: string;
			codec: string;
			binaryExists: boolean;
			modelsExist: boolean;
			root: string;
		};
		// All paths are weclank-owned — no stray Milady references.
		expect(status.root).toContain(".weclank/local-inference");
		expect(status.binary).toContain(".weclank/local-inference");
		expect(status.model).toContain(".weclank/local-inference");
		// We assert the *shape*, not the existence — the binary may not
		// be built yet on a fresh clone, and that's expected.
		expect(typeof status.binaryExists).toBe("boolean");
		expect(typeof status.modelsExist).toBe("boolean");

		await carrotHost.stop("omnivoice");
		await uninstall("omnivoice");
	}, 20_000);

	test.skipIf(!RUN_E2E)("synthesize returns a real RIFF WAV when artifacts exist", async () => {
		await installFromDir({
			sourcePath: CARROT_DIR,
			granted: { bun: { read: true, run: true, env: true } },
		});
		await setEnabled("omnivoice", true);
		await carrotHost.start("omnivoice");

		// prepare() downloads models if missing — first run will take a while.
		await carrotHost.invoke("omnivoice", "prepare", { force: false }, 10 * 60_000);

		// One short utterance.
		const result = (await carrotHost.invoke(
			"omnivoice",
			"synthesize",
			{ text: "Hi" },
			5 * 60_000,
		)) as { base64: string; mimeType: string; byteLength: number };

		expect(result.byteLength).toBeGreaterThan(1000);
		// RIFF magic ("RIFF" = 0x52 0x49 0x46 0x46) at byte 0 of every WAV.
		const head = Buffer.from(result.base64, "base64").subarray(0, 4);
		expect(head.toString("ascii")).toBe("RIFF");

		await carrotHost.stop("omnivoice");
		await uninstall("omnivoice");
	}, 11 * 60_000);
});
