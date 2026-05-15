// Per-session FFREPORT log management. The `FFREPORT` env var tells
// ffmpeg to write a verbose debug log to a file path; we point it at
// the user-data dir and prune older logs so the directory doesn't grow
// unboundedly.
//
// Reading the most recent log lines is what surfaces in the
// "View ffmpeg log" tile when something goes wrong.

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, unlink } from "node:fs/promises";
import { ffmpegLogDir } from "./paths";

const KEEP_RECENT_LOGS = 20;

export function ffmpegLogPath(sessionLabel: string, now = Date.now()): string {
	const dir = ffmpegLogDir();
	const raw = sessionLabel.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 24);
	// "raw" can be all-underscores (when the input was all non-alphanumeric);
	// require at least one alphanumeric for the label to be meaningful.
	const safe = /[A-Za-z0-9]/.test(raw) ? raw : "egress";
	const ts = new Date(now).toISOString().replace(/[:.]/g, "-");
	return `${dir}/${safe}-${ts}.log`;
}

/** FFREPORT format: `file=<path>:level=<int>`. Level 32 = info+warn+error
 *  (matches owncast). Higher levels (40 = verbose, 48 = debug) blow up
 *  log size. Path must not contain `:` on POSIX or `\` on Windows
 *  unescaped — we replace colons in the timestamp portion. */
export function ffreportEnvValue(logPath: string): string {
	// Escape the path's `:` (drive-letter on Windows; substituted in
	// timestamp). ffmpeg uses `\` to escape inside FFREPORT.
	const escaped = logPath.replace(/\\/g, "/").replace(/:/g, "\\:");
	return `file=${escaped}:level=32`;
}

export async function ensureLogDir(): Promise<void> {
	const dir = ffmpegLogDir();
	if (!existsSync(dir)) {
		await mkdir(dir, { recursive: true });
	}
}

/** Delete all but the N most recent .log files. Best-effort. */
export async function pruneOldFfmpegLogs(keep = KEEP_RECENT_LOGS): Promise<void> {
	const dir = ffmpegLogDir();
	if (!existsSync(dir)) return;
	let entries: string[];
	try {
		entries = await readdir(dir);
	} catch {
		return;
	}
	const logs = entries.filter((n) => n.endsWith(".log"));
	if (logs.length <= keep) return;
	const stats = await Promise.all(
		logs.map(async (name) => {
			try {
				const s = await stat(`${dir}/${name}`);
				return { name, mtime: s.mtimeMs };
			} catch {
				return { name, mtime: 0 };
			}
		}),
	);
	stats.sort((a, b) => b.mtime - a.mtime);
	const drop = stats.slice(keep);
	await Promise.all(
		drop.map(async ({ name }) => {
			try { await unlink(`${dir}/${name}`); } catch { /* ignore */ }
		}),
	);
}

/** Tail the most recently-modified ffmpeg log file. Returns up to `tail`
 *  trailing lines. */
export async function readRecentFfmpegLog(tail = 100): Promise<{ path?: string; lines: string[] }> {
	const dir = ffmpegLogDir();
	if (!existsSync(dir)) return { lines: [] };
	let entries: string[];
	try {
		entries = await readdir(dir);
	} catch {
		return { lines: [] };
	}
	const logs = entries.filter((n) => n.endsWith(".log"));
	if (logs.length === 0) return { lines: [] };
	const stats = await Promise.all(
		logs.map(async (name) => {
			try {
				const s = await stat(`${dir}/${name}`);
				return { name, mtime: s.mtimeMs };
			} catch {
				return null;
			}
		}),
	);
	const filtered = stats.filter((s): s is { name: string; mtime: number } => s !== null);
	if (filtered.length === 0) return { lines: [] };
	filtered.sort((a, b) => b.mtime - a.mtime);
	const newest = filtered[0]!;
	const path = `${dir}/${newest.name}`;
	try {
		const text = await readFile(path, "utf8");
		const lines = text.split(/\r?\n/);
		return { path, lines: lines.slice(-tail) };
	} catch {
		return { path, lines: [] };
	}
}
