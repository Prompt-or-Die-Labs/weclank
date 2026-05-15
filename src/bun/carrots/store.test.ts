// Store tests use an in-memory SQLite via setDbForTesting + a tmpdir
// fixture for the carrot source.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetDbForTesting, setDbForTesting } from "../db/schema";
import { getInstalled, installFromDir, listInstalled, setEnabled, uninstall, updateGrant } from "./store";

let fixtureDir: string;

async function makeFixture(id = "test-carrot"): Promise<string> {
	const dir = join(tmpdir(), `weclank-carrot-${id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "carrot.json"), JSON.stringify({
		id,
		name: "Test",
		version: "0.1.0",
		description: "fixture",
		permissions: { bun: { read: true, run: true }, isolation: "subprocess" },
		worker: { relativePath: "worker.mjs" },
	}));
	await writeFile(join(dir, "worker.mjs"), "// noop");
	return dir;
}

beforeEach(() => {
	setDbForTesting(new Database(":memory:"));
});
afterEach(async () => {
	resetDbForTesting();
	if (fixtureDir) {
		await rm(fixtureDir, { recursive: true, force: true }).catch(() => {});
	}
});

describe("carrot store", () => {
	test("install from dir persists the carrot", async () => {
		fixtureDir = await makeFixture();
		const result = await installFromDir({ sourcePath: fixtureDir, granted: { bun: { read: true, run: true } } });
		expect(result.created).toBe(true);
		expect(result.carrot.manifest.id).toBe("test-carrot");
		expect(result.carrot.granted.bun?.read).toBe(true);
		expect(result.carrot.enabled).toBe(false); // disabled by default

		const list = await listInstalled();
		expect(list).toHaveLength(1);
	});

	test("install only persists granted ∩ requested permissions", async () => {
		fixtureDir = await makeFixture();
		const r = await installFromDir({
			sourcePath: fixtureDir,
			granted: { bun: { read: true, run: true, write: true }, host: { storage: true } },
		});
		// write was not in manifest; storage was not in manifest
		expect(r.carrot.granted.bun?.write).toBeUndefined();
		expect(r.carrot.granted.host?.storage).toBeUndefined();
	});

	test("re-install updates instead of duplicating", async () => {
		fixtureDir = await makeFixture();
		await installFromDir({ sourcePath: fixtureDir, granted: { bun: { read: true } } });
		const second = await installFromDir({ sourcePath: fixtureDir, granted: { bun: { read: true } } });
		expect(second.created).toBe(false);
		const list = await listInstalled();
		expect(list).toHaveLength(1);
	});

	test("setEnabled flips the bit", async () => {
		fixtureDir = await makeFixture();
		await installFromDir({ sourcePath: fixtureDir, granted: { bun: { read: true } } });
		await setEnabled("test-carrot", true);
		const c = await getInstalled("test-carrot");
		expect(c?.enabled).toBe(true);
	});

	test("uninstall removes the row", async () => {
		fixtureDir = await makeFixture();
		await installFromDir({ sourcePath: fixtureDir, granted: { bun: { read: true } } });
		await uninstall("test-carrot");
		expect(await getInstalled("test-carrot")).toBeNull();
	});

	test("updateGrant intersects with manifest perms", async () => {
		fixtureDir = await makeFixture();
		await installFromDir({ sourcePath: fixtureDir, granted: { bun: { read: true } } });
		const updated = await updateGrant("test-carrot", {
			bun: { read: true, run: true, env: true }, // env not requested by manifest
		});
		expect(updated.granted.bun?.run).toBe(true);
		expect(updated.granted.bun?.env).toBeUndefined();
	});
});
