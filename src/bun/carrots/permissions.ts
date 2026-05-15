// Carrot permission helpers — flatten a grant into a tag set, parse tags
// back into grant fragments, and convert a granted set into the
// `Bun.spawn` permission filter the host will use.

import {
	BUN_PERMISSIONS,
	HOST_PERMISSIONS,
	CARROT_ISOLATIONS,
	type BunPermission,
	type CarrotIsolation,
	type CarrotPermissionGrant,
	type CarrotPermissionTag,
	type HostPermission,
} from "./types";

export function flattenPermissions(grant: CarrotPermissionGrant): CarrotPermissionTag[] {
	const tags: CarrotPermissionTag[] = [];
	for (const k of HOST_PERMISSIONS) {
		if (grant.host?.[k]) tags.push(`host:${k}` as CarrotPermissionTag);
	}
	for (const k of BUN_PERMISSIONS) {
		if (grant.bun?.[k]) tags.push(`bun:${k}` as CarrotPermissionTag);
	}
	if (grant.isolation) tags.push(`isolation:${grant.isolation}` as CarrotPermissionTag);
	return tags;
}

export function parsePermissionTag(tag: string): { kind: "host" | "bun" | "isolation"; value: string } | null {
	const sep = tag.indexOf(":");
	if (sep <= 0) return null;
	const kind = tag.slice(0, sep);
	const value = tag.slice(sep + 1);
	if (kind !== "host" && kind !== "bun" && kind !== "isolation") return null;
	return { kind, value };
}

export function isHostPermission(value: string): value is HostPermission {
	return (HOST_PERMISSIONS as readonly string[]).includes(value);
}
export function isBunPermission(value: string): value is BunPermission {
	return (BUN_PERMISSIONS as readonly string[]).includes(value);
}
export function isCarrotIsolation(value: string): value is CarrotIsolation {
	return (CARROT_ISOLATIONS as readonly string[]).includes(value);
}

/** Normalize: drop unknown keys, default isolation to `subprocess`. */
export function normalizePermissions(input: CarrotPermissionGrant): CarrotPermissionGrant {
	const out: CarrotPermissionGrant = {
		host: {},
		bun: {},
		isolation: "subprocess",
	};
	for (const k of HOST_PERMISSIONS) if (input.host?.[k]) out.host![k] = true;
	for (const k of BUN_PERMISSIONS) if (input.bun?.[k]) out.bun![k] = true;
	if (input.isolation && isCarrotIsolation(input.isolation)) out.isolation = input.isolation;
	return out;
}

/** Returns the granted intersection of `requested` ∩ `allowed`. */
export function intersectPermissions(
	requested: CarrotPermissionGrant,
	allowed: CarrotPermissionGrant,
): CarrotPermissionGrant {
	const out: CarrotPermissionGrant = { host: {}, bun: {}, isolation: requested.isolation ?? "subprocess" };
	for (const k of HOST_PERMISSIONS) {
		if (requested.host?.[k] && allowed.host?.[k]) out.host![k] = true;
	}
	for (const k of BUN_PERMISSIONS) {
		if (requested.bun?.[k] && allowed.bun?.[k]) out.bun![k] = true;
	}
	return out;
}

export function permissionsEqual(a: CarrotPermissionGrant, b: CarrotPermissionGrant): boolean {
	const flat = (g: CarrotPermissionGrant): string => flattenPermissions(g).sort().join("|");
	return flat(a) === flat(b);
}
