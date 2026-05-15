import { describe, expect, test } from "bun:test";
import { CarrotManifestError, validateManifest } from "./manifest";
import { flattenPermissions, intersectPermissions, normalizePermissions, parsePermissionTag } from "./permissions";

const okManifest = {
	id: "demo-carrot",
	name: "Demo",
	version: "0.1.0",
	description: "test fixture",
	permissions: { bun: { read: true, run: true }, isolation: "subprocess" },
	worker: { relativePath: "worker.mjs" },
};

describe("validateManifest", () => {
	test("accepts a well-formed manifest", () => {
		const m = validateManifest(okManifest);
		expect(m.id).toBe("demo-carrot");
		expect(m.permissions.bun?.read).toBe(true);
		expect(m.permissions.isolation).toBe("subprocess");
	});

	test("rejects non-object input", () => {
		expect(() => validateManifest(null)).toThrow(CarrotManifestError);
		expect(() => validateManifest("string")).toThrow(CarrotManifestError);
	});

	test("rejects bad id casing", () => {
		expect(() => validateManifest({ ...okManifest, id: "BadCase" })).toThrow(/Invalid id/);
		expect(() => validateManifest({ ...okManifest, id: "with space" })).toThrow(/Invalid id/);
	});

	test("rejects worker path traversal", () => {
		expect(() => validateManifest({ ...okManifest, worker: { relativePath: "../escape.mjs" } })).toThrow(/relative/);
		expect(() => validateManifest({ ...okManifest, worker: { relativePath: "/abs.mjs" } })).toThrow(/relative/);
	});

	test("normalizes unknown permission keys away", () => {
		const m = validateManifest({
			...okManifest,
			permissions: { bun: { read: true, ohno: true }, host: { evil: true } },
		});
		expect(m.permissions.bun).toEqual({ read: true });
		expect(m.permissions.host).toEqual({});
	});
});

describe("permissions helpers", () => {
	test("flatten + parse roundtrip", () => {
		const grant = { bun: { read: true, run: true }, host: { storage: true }, isolation: "subprocess" as const };
		const tags = flattenPermissions(grant);
		const tagStrings: string[] = [...tags].map((t) => String(t)).sort();
		expect(tagStrings).toEqual(["bun:read", "bun:run", "host:storage", "isolation:subprocess"].sort());
		for (const t of tags) expect(parsePermissionTag(t)).not.toBeNull();
	});

	test("intersect keeps only what's both requested AND allowed", () => {
		const requested = { bun: { read: true, run: true, write: true }, host: { storage: true } };
		const allowed = { bun: { read: true, run: true } };
		const out = intersectPermissions(requested, allowed);
		expect(out.bun?.read).toBe(true);
		expect(out.bun?.run).toBe(true);
		expect(out.bun?.write).toBeUndefined();
		expect(out.host?.storage).toBeUndefined();
	});

	test("normalize fills isolation default", () => {
		const out = normalizePermissions({});
		expect(out.isolation).toBe("subprocess");
	});
});
