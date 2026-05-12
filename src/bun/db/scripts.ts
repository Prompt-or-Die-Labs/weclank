// Script management — save, load, list, and generate scripts for teleprompter

import { openDb } from "./schema";


export interface Script {
	id: string;
	userId: string;
	title: string;
	content: string;
	isGenerated: boolean;
	generationTopic?: string;
	createdAt: number;
	updatedAt: number;
}

interface ScriptRow {
	id: string;
	user_id: string;
	title: string;
	content: string;
	is_generated: number;
	generation_topic: string | null;
	created_at: number;
	updated_at: number;
}

export async function saveScript(userId: string, title: string, content: string): Promise<Script> {
	const db = await openDb();
	const id = crypto.randomUUID();
	const now = Date.now();

	const stmt = db.prepare(`
		INSERT INTO scripts (id, user_id, title, content, is_generated, created_at, updated_at)
		VALUES (?, ?, ?, ?, 0, ?, ?)
	`);

	stmt.run(id, userId, title, content, now, now);

	return {
		id,
		userId,
		title,
		content,
		isGenerated: false,
		createdAt: now,
		updatedAt: now,
	};
}

export async function saveGeneratedScript(
	userId: string,
	title: string,
	content: string,
	topic: string,
): Promise<Script> {
	const db = await openDb();
	const id = crypto.randomUUID();
	const now = Date.now();

	const stmt = db.prepare(`
		INSERT INTO scripts (id, user_id, title, content, is_generated, generation_topic, created_at, updated_at)
		VALUES (?, ?, ?, ?, 1, ?, ?, ?)
	`);

	stmt.run(id, userId, title, content, topic, now, now);

	return {
		id,
		userId,
		title,
		content,
		isGenerated: true,
		generationTopic: topic,
		createdAt: now,
		updatedAt: now,
	};
}

export async function loadScript(userId: string, scriptId: string): Promise<Script | null> {
	const db = await openDb();
	const stmt = db.prepare("SELECT * FROM scripts WHERE id = ? AND user_id = ?");
	const row = stmt.get(scriptId, userId) as ScriptRow | null;

	if (!row) return null;

	return scriptFromRow(row);
}

export async function listScripts(userId: string): Promise<Script[]> {
	const db = await openDb();
	const stmt = db.prepare("SELECT * FROM scripts WHERE user_id = ? ORDER BY updated_at DESC");
	const rows = stmt.all(userId) as ScriptRow[];

	return rows.map(scriptFromRow);
}

function scriptFromRow(row: ScriptRow): Script {
	return {
		id: row.id,
		userId: row.user_id,
		title: row.title,
		content: row.content,
		isGenerated: row.is_generated === 1,
		generationTopic: row.generation_topic ?? undefined,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export async function deleteScript(userId: string, scriptId: string): Promise<boolean> {
	const db = await openDb();
	const stmt = db.prepare("DELETE FROM scripts WHERE id = ? AND user_id = ?");
	const result = stmt.run(scriptId, userId);
	return (result.changes ?? 0) > 0;
}

export async function updateScript(userId: string, scriptId: string, content: string): Promise<Script | null> {
	const db = await openDb();
	const now = Date.now();

	const stmt = db.prepare("UPDATE scripts SET content = ?, updated_at = ? WHERE id = ? AND user_id = ?");
	stmt.run(content, now, scriptId, userId);

	return loadScript(userId, scriptId);
}
