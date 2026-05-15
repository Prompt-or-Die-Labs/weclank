// SQLite schema + connection. Single file on disk in the user data dir
// (so it survives reinstalls). On open, run the migrations idempotently.
//
// Bun's `bun:sqlite` is built-in — no native module compilation, opens
// instantly, and the resulting file is plain-text-grep'able and
// portable. Foreign-key cascades on so deleting a user wipes their
// state + secrets in one transaction.

import { Database } from "bun:sqlite";
import { mkdir, chmod } from "node:fs/promises";
import { userDataDir } from "../paths";

let db: Database | null = null;

export async function openDb(): Promise<Database> {
	if (db) return db;
	const dir = userDataDir();
	await mkdir(dir, { recursive: true });
	const path = `${dir}/studio.db`;
	const opened = new Database(path, { create: true });
	opened.exec("PRAGMA foreign_keys = ON");
	opened.exec("PRAGMA journal_mode = WAL");
	opened.exec("PRAGMA synchronous = NORMAL");
	migrate(opened);
	db = opened;
	// 0600 on the db + its WAL/shm sidecars — only the owner can read
	// API keys and password hashes. Best-effort: chmod is a no-op on
	// Windows but doesn't error.
	for (const suffix of ["", "-wal", "-shm"]) {
		try { await chmod(path + suffix, 0o600); } catch { /* file may not exist yet */ }
	}
	return opened;
}

export function getDbPath(): string {
	return `${userDataDir()}/studio.db`;
}

/** Test hook: swap the singleton with an in-memory database. The test
 * runner calls this with a freshly-migrated `:memory:` DB so every test
 * gets a clean slate without touching the user's real file. */
export function setDbForTesting(testDb: Database): void {
	migrate(testDb);
	db = testDb;
}

/** Test hook: clear the singleton between test files. */
export function resetDbForTesting(): void {
	db = null;
}

function migrate(d: Database): void {
	d.exec(`
		CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			username TEXT UNIQUE NOT NULL,
			password_hash TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);

		CREATE TABLE IF NOT EXISTS user_state (
			user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
			state_json TEXT NOT NULL,
			updated_at INTEGER NOT NULL
		);

		CREATE TABLE IF NOT EXISTS user_secrets (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			key_name TEXT NOT NULL,
			value TEXT NOT NULL,
			updated_at INTEGER NOT NULL,
			PRIMARY KEY (user_id, key_name)
		);

		CREATE TABLE IF NOT EXISTS scripts (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			title TEXT NOT NULL,
			content TEXT NOT NULL,
			is_generated INTEGER DEFAULT 0,
			generation_topic TEXT,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);

		CREATE INDEX IF NOT EXISTS idx_scripts_user_id ON scripts(user_id);

		CREATE TABLE IF NOT EXISTS carrots (
			id TEXT PRIMARY KEY,
			manifest_json TEXT NOT NULL,
			source_path TEXT NOT NULL,
			enabled INTEGER NOT NULL DEFAULT 0,
			granted_permissions_json TEXT NOT NULL DEFAULT '{}',
			installed_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);
	`);
}
