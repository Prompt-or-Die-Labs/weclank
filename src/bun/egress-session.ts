// Egress session lifecycle. Owns:
//
//   - the active EgressSession (supervisor + lifecycle + stats + last
//     classified error), or null when idle
//   - the per-spawn stdout (progress) + stderr (classifier) readers
//   - FFREPORT log path provisioning + pruning
//
// Lives in its own module so `bun/index.ts` doesn't need to mix
// process-supervision plumbing with RPC-bus assembly. The exported
// surface is what the RPC handlers actually need:
//
//   - startEgressSession(args)  → success | error
//   - pushChunk(bytes)          → ok | error (with reconnect awareness)
//   - stopEgressSession()       → success (idempotent)
//   - currentStats()            → progress + lifecycle for the perf HUD
//   - currentError()            → classified error for the toast pipeline
//
// State is module-local. Only one session is active at a time.

import {
	buildFfmpegArgs,
	parseFfmpegProgressKv,
	type EgressStats,
	type EncoderProfile,
} from "./egress";
import {
	createEgressSupervisor,
	type EgressLifecycleState,
	type Supervisor,
} from "./egress-supervisor";
import { FfmpegStderrClassifier } from "./ffmpeg-errors";
import {
	ensureLogDir as ensureFfmpegLogDir,
	ffmpegLogPath,
	ffreportEnvValue,
	pruneOldFfmpegLogs,
} from "./ffmpeg-logs";
import { augmentedProcessEnv } from "./ffmpeg-env";
import { buildRtmpUrl } from "./egress";

interface EgressSession {
	supervisor: Supervisor;
	lifecycle: EgressLifecycleState;
	stats: EgressStats;
	/** Last user-facing error surfaced by the ffmpeg stderr classifier
	 *  OR by the supervisor lifecycle. The renderer polls this alongside
	 *  the progress stats so it can toast actionable messages
	 *  ("VAAPI driver not installed; falling back to libx264") instead
	 *  of a generic "ffmpeg died". */
	lastError: { message: string; severity: "fatal" | "transient" | "info"; at: number } | null;
}

let session: EgressSession | null = null;

export interface StartArgs {
	destinations: Array<{ rtmpUrl: string; streamKey: string }>;
	fps: number;
	videoBitsPerSecond: number;
	audioBitsPerSecond?: number;
	encoder: EncoderProfile;
}

export type StartResult = { success: true; destinationCount: number } | { success: false; error: string };

export async function startEgressSession(args: StartArgs): Promise<StartResult> {
	if (session) return { success: false, error: "Egress already running" };
	if (!args.destinations.length) return { success: false, error: "No destinations provided" };
	if (!Number.isFinite(args.fps) || args.fps <= 0) {
		return { success: false, error: "Invalid fps; expected positive number" };
	}
	if (!Number.isFinite(args.videoBitsPerSecond) || args.videoBitsPerSecond <= 0) {
		return { success: false, error: "Invalid videoBitsPerSecond; expected positive number" };
	}
	const targets = args.destinations.map((d) => buildRtmpUrl(d.rtmpUrl, d.streamKey));
	for (const t of targets) {
		if (!t.startsWith("rtmp://") && !t.startsWith("rtmps://")) {
			return { success: false, error: `Destination must use rtmp:// or rtmps://: ${t}` };
		}
	}

	try {
		// Per-session FFREPORT log under userDataDir()/logs/. ffmpeg
		// writes a verbose trace there; the renderer can pull the last
		// 100 lines via the existing readRecentFfmpegLog().
		await ensureFfmpegLogDir();
		const logPath = ffmpegLogPath(`egress-${targets.length}dst`);
		const env = { ...augmentedProcessEnv(), FFREPORT: ffreportEnvValue(logPath) };
		void pruneOldFfmpegLogs();

		// Pre-construct the session so callbacks can mutate it directly.
		// supervisor is patched in right after the call below.
		const next: EgressSession = {
			supervisor: null as unknown as Supervisor,
			lifecycle: { kind: "idle" },
			stats: {},
			lastError: null,
		};
		const supervisor = createEgressSupervisor({
			args: buildFfmpegArgs({
				encoder: args.encoder,
				targets,
				fps: args.fps,
				videoBitsPerSecond: args.videoBitsPerSecond,
				audioBitsPerSecond: args.audioBitsPerSecond,
			}),
			env,
			onStdout: (proc) => attachProgressReader(proc, next),
			onStderr: (proc) => attachClassifierReader(proc, next),
			onState: (s) => handleLifecycleChange(s, next),
		});
		next.supervisor = supervisor;
		await supervisor.start();
		session = next;
		return { success: true, destinationCount: targets.length };
	} catch (error) {
		session = null;
		return { success: false, error: (error as Error).message };
	}
}

export async function pushChunk(bytes: Uint8Array): Promise<{ ok: true } | { ok: false; error: string }> {
	if (!session) return { ok: false, error: "Egress not running" };
	const written = await session.supervisor.write(bytes);
	if (!written) {
		return { ok: false, error: "Egress write failed (reconnecting?)" };
	}
	return { ok: true };
}

export async function stopEgressSession(): Promise<{ success: true }> {
	if (!session) return { success: true };
	const sup = session.supervisor;
	session = null;
	// The supervisor handles SIGINT + drain + reconnect-abort in one
	// call. Bounded by its own internal wait on proc.exited; we add a
	// 3s cap on top as a safety net.
	try {
		await Promise.race([
			sup.stop(),
			new Promise((r) => setTimeout(r, 3_000)),
		]);
	} catch { /* noop */ }
	return { success: true };
}

export function currentStats(): EgressStats & {
	lifecycle: EgressLifecycleState["kind"];
	reconnectAttempt?: number;
	restarts?: number;
} {
	const lifecycle = session?.lifecycle ?? { kind: "idle" };
	return {
		...(session?.stats ?? {}),
		lifecycle: lifecycle.kind,
		reconnectAttempt: lifecycle.kind === "reconnecting" ? lifecycle.attempt : undefined,
		restarts: lifecycle.kind === "live" ? lifecycle.restarts : undefined,
	};
}

export function currentError(): { message?: string; severity?: "fatal" | "transient" | "info"; at?: number } {
	return session?.lastError ? { ...session.lastError } : {};
}

/** Read-only check: is an egress session active? */
export function hasActiveSession(): boolean {
	return session !== null;
}

// ---- Internal: per-spawn reader attachment -----------------------

function attachProgressReader(proc: Bun.Subprocess<"pipe", "pipe", "pipe">, next: EgressSession): void {
	// `-progress pipe:1 -nostats` emits stable key=value blocks
	// terminated by `progress=continue` or `progress=end`. Per-spawn
	// reader; closed when the proc exits. Every settled block is also
	// a heartbeat for the StaleTimeout watchdog — if ffmpeg goes
	// silent (e.g. RTMP receiver died but TCP buffer absorbs writes),
	// the watchdog kills it and the exit-watcher triggers respawn.
	void (async (): Promise<void> => {
		const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		let block: string[] = [];
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const parts = buffer.split("\n");
				buffer = parts.pop() ?? "";
				for (const line of parts) {
					const trimmed = line.trim();
					if (!trimmed) continue;
					block.push(trimmed);
					if (trimmed.startsWith("progress=")) {
						next.stats = parseFfmpegProgressKv(next.stats, block);
						block = [];
						next.supervisor?.noteActivity();
					}
				}
			}
		} catch { /* stream torn down on respawn */ }
	})();
}

function attachClassifierReader(proc: Bun.Subprocess<"pipe", "pipe", "pipe">, next: EgressSession): void {
	// Per-spawn classifier — the dedup state is local to the current
	// ffmpeg process. The classifier converts known failure patterns
	// ("Unknown encoder", "Connection refused") into friendly user
	// messages with severity hints.
	const classifier = new FfmpegStderrClassifier();
	void (async (): Promise<void> => {
		const reader = (proc.stderr as ReadableStream<Uint8Array>).getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const parts = buffer.split(/[\r\n]/);
				buffer = parts.pop() ?? "";
				for (const line of parts) {
					const trimmed = line.trim();
					if (!trimmed) continue;
					const result = classifier.classify(trimmed);
					if (result.ignore) continue;
					if (result.userMessage) {
						next.lastError = {
							message: result.userMessage,
							severity: result.severity ?? "fatal",
							at: Date.now(),
						};
						console.warn("[ffmpeg]", trimmed, "→", result.userMessage);
					} else {
						console.log("[ffmpeg]", trimmed);
					}
				}
			}
		} catch { /* stream torn down on respawn */ }
	})();
}

function handleLifecycleChange(s: EgressLifecycleState, next: EgressSession): void {
	next.lifecycle = s;
	// Surface lifecycle transitions as last-error so the renderer's
	// toast pipeline catches them. Don't overwrite a more-specific
	// classifier message (it has the same `at` precedence).
	if (s.kind === "reconnecting") {
		next.lastError = {
			message: `Stream dropped — reconnecting (attempt ${s.attempt}). ${s.lastError ?? ""}`.trim(),
			severity: "transient",
			at: Date.now(),
		};
		console.warn(`[egress] reconnecting attempt=${s.attempt} cause="${s.lastError ?? ""}"`);
	} else if (s.kind === "failed") {
		next.lastError = {
			message: `Stream lost — couldn't reconnect (${s.lastError}). Stop and restart the broadcast.`,
			severity: "fatal",
			at: Date.now(),
		};
		console.error(`[egress] gave up after retries: ${s.lastError}`);
	} else if (s.kind === "live") {
		if (s.restarts > 0) {
			console.log(`[egress] reconnected (restart #${s.restarts})`);
		}
	}
}
