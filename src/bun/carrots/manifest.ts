// Load + validate a carrot.json from disk. Surfaces a clear error for
// malformed manifests so the install consent dialog can show the user
// exactly what's wrong.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizePermissions } from "./permissions";
import type { CarrotManifest, CarrotPermissionGrant, CarrotViewManifest } from "./types";

// CarrotViewManifest is a public subtype the validator returns.
export type { CarrotViewManifest };

export class CarrotManifestError extends Error {}

export async function readManifest(sourcePath: string): Promise<CarrotManifest> {
	const manifestPath = join(sourcePath, "carrot.json");
	let raw: string;
	try {
		raw = await readFile(manifestPath, "utf8");
	} catch (err) {
		throw new CarrotManifestError(
			`Could not read ${manifestPath}: ${(err as Error).message}`,
		);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		throw new CarrotManifestError(`Invalid JSON in ${manifestPath}: ${(err as Error).message}`);
	}
	return validateManifest(parsed);
}

export function validateManifest(input: unknown): CarrotManifest {
	if (!input || typeof input !== "object") {
		throw new CarrotManifestError("manifest must be a JSON object");
	}
	const m = input as Record<string, unknown>;

	const id = asString(m["id"], "id");
	if (!/^[a-z][a-z0-9-]{1,63}$/.test(id)) {
		throw new CarrotManifestError(`Invalid id "${id}" — must be lower-kebab, 2–64 chars`);
	}
	const name = asString(m["name"], "name");
	const version = asString(m["version"], "version");
	const description = asString(m["description"], "description");
	const long_description = m["long_description"] == null ? undefined : asString(m["long_description"], "long_description");
	const homepage = m["homepage"] == null ? undefined : asString(m["homepage"], "homepage");

	const worker = m["worker"];
	if (!worker || typeof worker !== "object") {
		throw new CarrotManifestError("manifest.worker must be an object with relativePath");
	}
	const workerRel = asString((worker as Record<string, unknown>)["relativePath"], "worker.relativePath");
	if (workerRel.includes("..") || workerRel.startsWith("/") || workerRel.startsWith("\\")) {
		throw new CarrotManifestError(
			`worker.relativePath "${workerRel}" must be relative and stay inside the carrot directory`,
		);
	}

	const permissions: CarrotPermissionGrant = normalizePermissions(
		(m["permissions"] ?? {}) as CarrotPermissionGrant,
	);

	const view = parseView(m["view"]);

	return {
		id,
		name,
		version,
		description,
		long_description,
		permissions,
		worker: { relativePath: workerRel },
		view,
		homepage,
	};
}

function parseView(v: unknown): CarrotManifest["view"] {
	if (v == null) return undefined;
	if (typeof v !== "object") throw new CarrotManifestError("manifest.view must be an object");
	const o = v as Record<string, unknown>;
	const relativePath = asString(o["relativePath"], "view.relativePath");
	if (relativePath.includes("..") || relativePath.startsWith("/") || relativePath.startsWith("\\")) {
		throw new CarrotManifestError(`view.relativePath "${relativePath}" must be relative and inside the carrot directory`);
	}
	const titleVal = o["title"];
	const widthVal = o["width"];
	const heightVal = o["height"];
	const titleBarVal = o["titleBarStyle"];
	const out: NonNullable<CarrotManifest["view"]> = { relativePath };
	if (typeof titleVal === "string" && titleVal.length > 0) out.title = titleVal;
	if (typeof widthVal === "number" && widthVal > 0) out.width = Math.floor(widthVal);
	if (typeof heightVal === "number" && heightVal > 0) out.height = Math.floor(heightVal);
	if (titleBarVal === "hidden" || titleBarVal === "hiddenInset" || titleBarVal === "default") out.titleBarStyle = titleBarVal;
	return out;
}

function asString(v: unknown, label: string): string {
	if (typeof v !== "string" || v.length === 0) {
		throw new CarrotManifestError(`manifest.${label} must be a non-empty string`);
	}
	return v;
}
