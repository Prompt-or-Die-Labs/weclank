// Per-user state + secrets storage. The renderer hands us the full
// PersistedState JSON; we just upsert it. Secrets are namespaced by
// `key_name` (e.g. 'openrouter', 'elevenlabs', 'rtmp_url').

import { openDb } from "./schema";

const KEYCHAIN_MARKER = "weclank:keychain:v1";
const PLAIN_MARKER = "weclank:plain:v1:";
const KEYCHAIN_SERVICE_PREFIX = "Weclank";

export interface SecretStore {
	read(account: string, service: string): Promise<string | null>;
	write(account: string, service: string, value: string): Promise<void>;
	delete(account: string, service: string): Promise<void>;
}

let secretStoreOverride: SecretStore | null | undefined;

export function setSecretStoreForTesting(store: SecretStore | null | undefined): void {
	secretStoreOverride = store;
}

export async function loadState(userId: string): Promise<{ state?: string }> {
	const db = await openDb();
	const row = db.query("SELECT state_json FROM user_state WHERE user_id = ?").get(userId) as
		| { state_json: string }
		| null;
	return row ? { state: row.state_json } : {};
}

export async function saveState(userId: string, state: string): Promise<{ success: boolean }> {
	const db = await openDb();
	const now = Date.now();
	db.run(
		`INSERT INTO user_state (user_id, state_json, updated_at) VALUES (?, ?, ?)
		 ON CONFLICT(user_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`,
		[userId, state, now],
	);
	return { success: true };
}

export async function loadAllSecrets(userId: string): Promise<Record<string, string>> {
	const db = await openDb();
	const rows = db.query("SELECT key_name, value FROM user_secrets WHERE user_id = ?").all(userId) as Array<{
		key_name: string;
		value: string;
	}>;
	const out: Record<string, string> = {};
	for (const r of rows) {
		const value = await resolveSecretValue(userId, r.key_name, r.value);
		if (value != null) out[r.key_name] = value;
	}
	return out;
}

export async function loadSecret(userId: string, key: string): Promise<string> {
	const db = await openDb();
	const row = db.query("SELECT value FROM user_secrets WHERE user_id = ? AND key_name = ?").get(userId, key) as
		| { value: string }
		| null;
	if (!row) return "";
	return (await resolveSecretValue(userId, key, row.value)) ?? "";
}

export async function setSecret(userId: string, key: string, value: string): Promise<{ success: boolean; storage: "keychain" | "sqlite" }> {
	const db = await openDb();
	const now = Date.now();
	const storedValue = await storedSecretValue(userId, key, value);
	db.run(
		`INSERT INTO user_secrets (user_id, key_name, value, updated_at) VALUES (?, ?, ?, ?)
		 ON CONFLICT(user_id, key_name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
		[userId, key, storedValue.value, now],
	);
	return { success: true, storage: storedValue.storage };
}

export async function deleteSecret(userId: string, key: string): Promise<{ success: boolean }> {
	const db = await openDb();
	const row = db.query("SELECT value FROM user_secrets WHERE user_id = ? AND key_name = ?").get(userId, key) as
		| { value: string }
		| null;
	if (row?.value === KEYCHAIN_MARKER) {
		await selectSecretStore()?.delete(userId, serviceFor(key));
	}
	db.run("DELETE FROM user_secrets WHERE user_id = ? AND key_name = ?", [userId, key]);
	return { success: true };
}

export async function deleteAllSecretsForUser(userId: string): Promise<void> {
	const db = await openDb();
	const rows = db.query("SELECT key_name, value FROM user_secrets WHERE user_id = ?").all(userId) as Array<{
		key_name: string;
		value: string;
	}>;
	const store = selectSecretStore();
	for (const row of rows) {
		if (row.value === KEYCHAIN_MARKER) await store?.delete(userId, serviceFor(row.key_name));
	}
	db.run("DELETE FROM user_secrets WHERE user_id = ?", [userId]);
}

async function storedSecretValue(userId: string, key: string, value: string): Promise<{ value: string; storage: "keychain" | "sqlite" }> {
	const store = selectSecretStore();
	if (!store) return { value: `${PLAIN_MARKER}${value}`, storage: "sqlite" };
	await store.write(userId, serviceFor(key), value);
	return { value: KEYCHAIN_MARKER, storage: "keychain" };
}

async function resolveSecretValue(userId: string, key: string, value: string): Promise<string | null> {
	if (value === KEYCHAIN_MARKER) return selectSecretStore()?.read(userId, serviceFor(key)) ?? null;
	if (value.startsWith(PLAIN_MARKER)) return value.slice(PLAIN_MARKER.length);
	return value;
}

function selectSecretStore(): SecretStore | null {
	if (secretStoreOverride !== undefined) return secretStoreOverride;
	if (process.platform !== "darwin") return null;
	return macosKeychainStore;
}

function serviceFor(key: string): string {
	return `${KEYCHAIN_SERVICE_PREFIX}:${key}`;
}

const macosKeychainStore: SecretStore = {
	async read(account, service) {
		const result = await runSecurity(["find-generic-password", "-a", account, "-s", service, "-w"]);
		if (result.exitCode !== 0) return null;
		return result.stdout.replace(/\n$/, "");
	},
	async write(account, service, value) {
		const result = await runSecurity(["add-generic-password", "-a", account, "-s", service, "-w", value, "-U"]);
		if (result.exitCode !== 0) throw new Error(result.stderr.trim() || "Could not save secret to macOS Keychain");
	},
	async delete(account, service) {
		await runSecurity(["delete-generic-password", "-a", account, "-s", service]);
	},
};

async function runSecurity(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const proc = Bun.spawn(["/usr/bin/security", ...args], { stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { exitCode, stdout, stderr };
}
