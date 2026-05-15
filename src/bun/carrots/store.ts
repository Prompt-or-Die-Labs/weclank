// Carrot store — persists the registry in studio.db and resolves runtime
// paths (state, logs). Install just records the source directory; we do
// NOT copy the carrot's files into the user data dir in v1 (the carrot
// can live anywhere on disk the host can read).

import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { openDb } from "../db/schema";
import { readManifest } from "./manifest";
import { intersectPermissions, normalizePermissions, permissionsEqual } from "./permissions";
import type { CarrotManifest, CarrotPermissionGrant, CarrotRuntimeContext, InstalledCarrot } from "./types";

interface CarrotRow {
	id: string;
	manifest_json: string;
	source_path: string;
	enabled: number;
	granted_permissions_json: string;
	installed_at: number;
	updated_at: number;
}

function rowToInstalled(row: CarrotRow): InstalledCarrot {
	return {
		id: row.id,
		manifest: JSON.parse(row.manifest_json) as CarrotManifest,
		sourcePath: row.source_path,
		enabled: row.enabled === 1,
		granted: JSON.parse(row.granted_permissions_json) as CarrotPermissionGrant,
		installedAt: row.installed_at,
		updatedAt: row.updated_at,
	};
}

export async function listInstalled(): Promise<InstalledCarrot[]> {
	const db = await openDb();
	const rows = db.query("SELECT * FROM carrots ORDER BY installed_at").all() as CarrotRow[];
	return rows.map(rowToInstalled);
}

export async function getInstalled(id: string): Promise<InstalledCarrot | null> {
	const db = await openDb();
	const row = db.query("SELECT * FROM carrots WHERE id = ?").get(id) as CarrotRow | null;
	return row ? rowToInstalled(row) : null;
}

export interface InstallResult {
	carrot: InstalledCarrot;
	/** True if this install added a new row; false if it updated an existing one. */
	created: boolean;
}

/** Install (or refresh) a carrot from a local directory. The caller is
 * responsible for collecting user consent for the granted permissions —
 * we just persist what was granted. */
export async function installFromDir(args: {
	sourcePath: string;
	granted: CarrotPermissionGrant;
}): Promise<InstallResult> {
	const sourcePath = resolve(args.sourcePath);
	const manifest = await readManifest(sourcePath);
	const granted = intersectPermissions(manifest.permissions, normalizePermissions(args.granted));
	const db = await openDb();
	const now = Date.now();
	const existing = db.query("SELECT id FROM carrots WHERE id = ?").get(manifest.id);
	const created = !existing;
	db.run(
		`INSERT INTO carrots (id, manifest_json, source_path, enabled, granted_permissions_json, installed_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET
		   manifest_json = excluded.manifest_json,
		   source_path = excluded.source_path,
		   granted_permissions_json = excluded.granted_permissions_json,
		   updated_at = excluded.updated_at`,
		[
			manifest.id,
			JSON.stringify(manifest),
			sourcePath,
			created ? 0 : 1,
			JSON.stringify(granted),
			now,
			now,
		],
	);
	const row = db.query("SELECT * FROM carrots WHERE id = ?").get(manifest.id) as CarrotRow;
	return { carrot: rowToInstalled(row), created };
}

export async function setEnabled(id: string, enabled: boolean): Promise<void> {
	const db = await openDb();
	db.run("UPDATE carrots SET enabled = ?, updated_at = ? WHERE id = ?", [enabled ? 1 : 0, Date.now(), id]);
}

export async function uninstall(id: string): Promise<void> {
	const db = await openDb();
	db.run("DELETE FROM carrots WHERE id = ?", [id]);
}

/** Update the granted-permission grant for an already-installed carrot.
 * Caller should ensure user re-consented if new tags appear. */
export async function updateGrant(id: string, granted: CarrotPermissionGrant): Promise<InstalledCarrot> {
	const existing = await getInstalled(id);
	if (!existing) throw new Error(`Carrot ${id} not installed`);
	const next = intersectPermissions(existing.manifest.permissions, normalizePermissions(granted));
	if (permissionsEqual(existing.granted, next)) return existing;
	const db = await openDb();
	db.run(
		"UPDATE carrots SET granted_permissions_json = ?, updated_at = ? WHERE id = ?",
		[JSON.stringify(next), Date.now(), id],
	);
	return { ...existing, granted: next, updatedAt: Date.now() };
}

/** Returns the on-disk runtime paths for a carrot. Creates the parent
 * directories so the worker can write logs / state immediately. */
export async function buildRuntimeContext(carrot: InstalledCarrot, channel: "dev" | "canary" | "release"): Promise<CarrotRuntimeContext> {
	const carrotDir = await carrotDataDir(carrot.id);
	const ctx: CarrotRuntimeContext = {
		manifest: carrot.manifest,
		granted: carrot.granted,
		statePath: join(carrotDir, "state.json"),
		logsPath: join(carrotDir, "carrot.log"),
		channel,
	};
	return ctx;
}

/** ~/Library/Application Support/Weclank/carrots/<id>/ */
async function carrotDataDir(id: string): Promise<string> {
	const home = Bun.env["HOME"] ?? "";
	const base =
		process.platform === "darwin"
			? `${home}/Library/Application Support/Weclank/carrots`
			: process.platform === "win32"
				? `${Bun.env["APPDATA"] ?? home}/Weclank/carrots`
				: `${Bun.env["XDG_CONFIG_HOME"] ?? `${home}/.config`}/weclank/carrots`;
	const dir = join(base, id);
	await mkdir(dir, { recursive: true });
	return dir;
}
