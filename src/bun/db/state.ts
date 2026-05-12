// Per-user state + secrets storage. The renderer hands us the full
// PersistedState JSON; we just upsert it. Secrets are namespaced by
// `key_name` (e.g. 'openrouter', 'elevenlabs', 'suno', 'rtmp_url').
//
// Secrets are stored in plain text — same model as VS Code / Cursor /
// every other local desktop app. Users uneasy about this can encrypt the
// SQLite file at rest with FileVault / BitLocker / LUKS.

import { openDb } from "./schema";

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
	for (const r of rows) out[r.key_name] = r.value;
	return out;
}

export async function setSecret(userId: string, key: string, value: string): Promise<{ success: boolean }> {
	const db = await openDb();
	const now = Date.now();
	db.run(
		`INSERT INTO user_secrets (user_id, key_name, value, updated_at) VALUES (?, ?, ?, ?)
		 ON CONFLICT(user_id, key_name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
		[userId, key, value, now],
	);
	return { success: true };
}

export async function deleteSecret(userId: string, key: string): Promise<{ success: boolean }> {
	const db = await openDb();
	db.run("DELETE FROM user_secrets WHERE user_id = ? AND key_name = ?", [userId, key]);
	return { success: true };
}
