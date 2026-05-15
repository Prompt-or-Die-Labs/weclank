// Persisted obs-websocket config + last-startup-error state.
//
// Lives in its own module so:
//   1. The shape is testable in isolation (no need to boot the whole
//      Bun process to verify read/write/validate semantics).
//   2. Bun's index.ts only sees a clean read/write/applyState API, not
//      file paths or JSON parsing.
//
// The persisted file is `userDataDir()/obs-ws.json`. The runtime state
// (last-error) is in-memory only — fresh boot = clean slate.

import { userDataDir } from "../paths";

export interface ObsWsConfig {
	enabled: boolean;
	port: number;
	hostname: string;
	password?: string;
}

export interface ObsWsConfigSnapshot extends ObsWsConfig {
	/** True if the server is currently bound + accepting connections.
	 *  Runtime state — not persisted. */
	listening: boolean;
	/** If `applyObsWsServerState` last tried to start and failed
	 *  (e.g. port in use, privileged port, bad config), this carries
	 *  the surfaced reason. Cleared on the next successful start. */
	lastStartupError: string | null;
}

const DEFAULT: ObsWsConfig = {
	enabled: false,
	port: 4455,
	hostname: "127.0.0.1",
};

function configPath(): string {
	return `${userDataDir()}/obs-ws.json`;
}

export async function readObsWsConfig(): Promise<ObsWsConfig> {
	try {
		const text = await Bun.file(configPath()).text();
		const parsed = JSON.parse(text) as Partial<ObsWsConfig>;
		return { ...DEFAULT, ...parsed };
	} catch {
		return { ...DEFAULT };
	}
}

/** Validates the proposed config. Throws on policy violations
 *  (e.g. LAN exposure without password). Pure function — no I/O. */
export function validateObsWsConfig(next: ObsWsConfig): void {
	if (!next.enabled) return;
	const isLoopback = next.hostname === "127.0.0.1" || next.hostname === "localhost";
	if (!isLoopback && !next.password) {
		throw new Error("LAN exposure requires a password");
	}
	if (!Number.isInteger(next.port) || next.port < 1 || next.port > 65535) {
		throw new Error("port must be 1..65535");
	}
}

export async function writeObsWsConfig(patch: Partial<ObsWsConfig>): Promise<ObsWsConfig> {
	const current = await readObsWsConfig();
	const next = { ...current, ...patch };
	validateObsWsConfig(next);
	await Bun.write(configPath(), JSON.stringify(next, null, "\t"));
	return next;
}
