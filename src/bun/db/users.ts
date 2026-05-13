// User account helpers — signup, login, delete. Passwords are hashed with
// argon2id via Bun's built-in `Bun.password`. No external auth deps.
//
// Username constraint: 3–32 chars, [a-zA-Z0-9_-]. Password constraint:
// minimum 8 chars. Both enforced at this layer so the renderer-side
// dialog can rely on the server doing the check.

import { openDb } from "./schema";
import { deleteAllSecretsForUser } from "./state";

const USERNAME_REGEX = /^[a-zA-Z0-9_-]{3,32}$/;

export interface UserRow {
	id: string;
	username: string;
	password_hash: string;
	created_at: number;
	updated_at: number;
}

export async function signup(username: string, password: string): Promise<{ userId: string } | { error: string }> {
	if (!USERNAME_REGEX.test(username)) {
		return { error: "Username must be 3–32 characters, letters/digits/underscore/dash only." };
	}
	if (password.length < 8) {
		return { error: "Password must be at least 8 characters." };
	}
	const db = await openDb();
	const existing = db.query("SELECT id FROM users WHERE username = ?").get(username) as { id: string } | null;
	if (existing) return { error: "That username is taken." };

	const id = `u-${crypto.randomUUID()}`;
	const password_hash = await Bun.password.hash(password); // argon2id by default
	const now = Date.now();
	db.run(
		"INSERT INTO users (id, username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
		[id, username, password_hash, now, now],
	);
	return { userId: id };
}

export async function login(username: string, password: string): Promise<{ userId: string } | { error: string }> {
	const db = await openDb();
	const row = db.query("SELECT id, password_hash FROM users WHERE username = ?").get(username) as
		| { id: string; password_hash: string }
		| null;
	if (!row) return { error: "Unknown username or wrong password." };
	const ok = await Bun.password.verify(password, row.password_hash);
	if (!ok) return { error: "Unknown username or wrong password." };
	return { userId: row.id };
}

export async function checkUser(username: string): Promise<{ exists: boolean }> {
	const db = await openDb();
	const row = db.query("SELECT 1 FROM users WHERE username = ?").get(username);
	return { exists: row != null };
}

export async function deleteAccount(userId: string): Promise<{ success: boolean }> {
	await deleteAllSecretsForUser(userId);
	const db = await openDb();
	const result = db.run("DELETE FROM users WHERE id = ?", [userId]);
	return { success: result.changes > 0 };
}

export async function lookupUsername(userId: string): Promise<{ username?: string }> {
	const db = await openDb();
	const row = db.query("SELECT username FROM users WHERE id = ?").get(userId) as { username: string } | null;
	return row ? { username: row.username } : {};
}
