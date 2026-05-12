// In-memory cache of the current user's secrets (API keys, RTMP creds).
// Populated at login from SQLite; reads stay synchronous so the existing
// TTS providers / streaming code can read keys without awaiting an RPC
// on every call. Writes go through Bun so they persist.
//
// Cache is per-process-lifetime. Clears on logout.

import { bunRpc } from "../rpc";

const cache = new Map<string, string>();
let activeUserId: string | null = null;

export async function loadCache(userId: string): Promise<void> {
	activeUserId = userId;
	cache.clear();
	const result = await bunRpc.userLoadSecrets({ userId });
	for (const [k, v] of Object.entries(result.secrets)) cache.set(k, v);
	// Migrate legacy key name: OAuth previously stored under "openrouter_api_key"
	// but all consumers read "openrouter". Copy across + persist the canonical name.
	const legacy = cache.get("openrouter_api_key");
	if (legacy && !cache.get("openrouter")) {
		cache.set("openrouter", legacy);
		await bunRpc.userSetSecret({ userId, key: "openrouter", value: legacy });
	}
}

export function clearCache(): void {
	cache.clear();
	activeUserId = null;
}

export function getSecret(key: string): string {
	return cache.get(key) ?? "";
}

export function hasSecret(key: string): boolean {
	const v = cache.get(key);
	return v != null && v.length > 0;
}

export async function setSecretAndPersist(key: string, value: string): Promise<void> {
	if (!activeUserId) throw new Error("No active user — log in first");
	cache.set(key, value);
	await bunRpc.userSetSecret({ userId: activeUserId, key, value });
}

export async function deleteSecretAndPersist(key: string): Promise<void> {
	if (!activeUserId) return;
	cache.delete(key);
	await bunRpc.userDeleteSecret({ userId: activeUserId, key });
}
