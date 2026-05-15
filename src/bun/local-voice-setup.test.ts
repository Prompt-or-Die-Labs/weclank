// End-to-end smoke for the localVoiceSetup RPC handler.
//
// Exercises the handler logic directly (no Electrobun harness), in
// order:
//   1. status before install → carrot not installed, bundled path
//      resolved.
//   2. install → carrot installed + enabled + running.
//   3. status after install → reflects the new state and reports the
//      worker's snapshot (binary / models).
//
// `prepare` is NOT exercised here — it downloads ~660 MB and is
// covered by the gated E2E in carrots/omnivoice.integration.test.ts.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { resetDbForTesting, setDbForTesting } from "./db/schema";
import { carrotHost } from "./carrots/host";
import { getInstalled, setEnabled, uninstall } from "./carrots/store";
import { installFromDir } from "./carrots/store";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const BUNDLED_CARROT_DIR = join(REPO_ROOT, "carrots", "omnivoice");

beforeEach(() => {
	setDbForTesting(new Database(":memory:"));
});

afterEach(async () => {
	await carrotHost.stopAll();
	resetDbForTesting();
});

describe("local voice setup (mirrors localVoiceSetup RPC)", () => {
	test("repo ships the bundled omnivoice carrot", () => {
		// Sanity — if this file moves, the resolveBundledOmnivoiceCarrotPath()
		// candidates in src/bun/index.ts need to follow.
		expect(existsSync(join(BUNDLED_CARROT_DIR, "carrot.json"))).toBe(true);
	});

	test("install flow installs + enables + starts the carrot", async () => {
		// 1. Initial state — nothing installed.
		expect(await getInstalled("omnivoice")).toBeNull();

		// 2. Install (mirrors the RPC's "install" branch).
		const install = await installFromDir({
			sourcePath: BUNDLED_CARROT_DIR,
			granted: { bun: { read: true, run: true, env: true } },
		});
		expect(install.carrot.id).toBe("omnivoice");
		await setEnabled("omnivoice", true);
		await carrotHost.start("omnivoice");

		// 3. State after install — installed, enabled, running.
		const after = await getInstalled("omnivoice");
		expect(after).not.toBeNull();
		expect(after?.enabled).toBe(true);
		expect(carrotHost.isRunning("omnivoice")).toBe(true);

		// 4. status invoke mirrors the RPC's status collection — the
		//    handler will report these same fields to the renderer.
		const snap = (await carrotHost.invoke("omnivoice", "status", {}, 5_000)) as {
			binaryExists: boolean; modelsExist: boolean;
			binary: string; model: string; codec: string;
		};
		expect(typeof snap.binaryExists).toBe("boolean");
		expect(typeof snap.modelsExist).toBe("boolean");
		expect(snap.binary.length).toBeGreaterThan(0);
		expect(snap.model.length).toBeGreaterThan(0);
		expect(snap.codec.length).toBeGreaterThan(0);

		await uninstall("omnivoice");
	}, 20_000);
});
