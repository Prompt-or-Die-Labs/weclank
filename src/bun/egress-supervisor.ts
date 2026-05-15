// Egress supervisor. Owns the ffmpeg subprocess lifecycle across
// disconnects.
//
// The renderer drives the public API: `start()` spins up ffmpeg; chunks
// get pushed via `write()`; `stop()` clean-shutdowns. If ffmpeg exits
// unexpectedly while we're still considered live, the supervisor
// re-spawns with the same args using decorrelated-jitter backoff (the
// shared `shared/retry.ts` primitive — same one that handles Twitch IRC
// reconnect today).
//
// Numbers from the OBS audit (libobs/obs-output.c):
//   - initial delay  2s
//   - max delay      15 min
//   - cap on attempts 20
//   - decorrelated jitter in [base, prev*3] (weclank's existing retry
//     primitive — distinct from OBS's `1.5^n + ±0.05` but arrives at
//     the same "spread retries, don't thunderbolt the upstream" goal)
//
// FFmpeg anti-recommendation from the ffmpeg audit: do NOT add
// `-reconnect 1` to the ffmpeg args — that flag is HTTP-input-only.
// RTMP output has no built-in reconnect; the only correct fix is
// re-spawning the process here.

import { withBackoff } from "../shared/retry";

export type EgressLifecycleState =
	| { kind: "idle" }
	// ffmpeg has been spawned and survived the 200ms quick-death window,
	// but hasn't yet emitted a progress block (= no bytes have actually
	// hit the RTMP receiver). Most RTMP rejections happen here:
	// "Connection refused", "401", "stream key invalid", an X account
	// without Producer access etc. We DELIBERATELY don't claim "live"
	// during this window — the LIVE pill and the "Live on N" toast both
	// gate on the live transition below.
	| { kind: "starting"; sinceMs: number }
	| { kind: "live"; sinceMs: number; restarts: number }
	| { kind: "reconnecting"; attempt: number; sinceMs: number; lastError?: string }
	| { kind: "failed"; sinceMs: number; lastError: string };

export interface SupervisorOptions {
	/** ffmpeg argv. The first element should be "ffmpeg"; supervisor
	 *  strips and passes the rest to Bun.spawn. */
	args: string[];
	env?: Record<string, string | undefined>;
	/** Hooks the supervisor uses to surface lifecycle events. */
	onStdout?: (proc: Bun.Subprocess<"pipe", "pipe", "pipe">) => void;
	onStderr?: (proc: Bun.Subprocess<"pipe", "pipe", "pipe">) => void;
	onState?: (state: EgressLifecycleState) => void;
	/** Initial reconnect delay. Default 2_000ms (OBS default). */
	initialReconnectDelayMs?: number;
	/** Hard cap on reconnect delay. Default 15 * 60 * 1000ms (OBS cap). */
	maxReconnectDelayMs?: number;
	/** Max reconnect attempts before giving up. Default 20 (OBS default). */
	maxReconnectAttempts?: number;
	/** Stale-timeout watchdog. If `noteActivity()` isn't called within
	 *  this many ms while live, the supervisor SIGKILLs the ffmpeg
	 *  child — the exit-watcher then triggers the respawn loop.
	 *
	 *  Solves the failure mode where ffmpeg's RTMP writer buffers
	 *  bytes after the remote socket dies and ffmpeg doesn't notice
	 *  for 10+ seconds. Direct port of restreamer's `StaleTimeout`
	 *  (core/process/process.go).
	 *
	 *  Set to 0 to disable. Default 10_000ms — long enough that
	 *  legitimate slow encoder ticks don't trigger it; short enough
	 *  that dead-RTMP-receiver is caught in <15s end-to-end. */
	staleTimeoutMs?: number;
	/** Connect-timeout. If a freshly-spawned ffmpeg sits in `starting`
	 *  for this many ms without ever emitting a progress block, the
	 *  supervisor SIGKILLs it. The exit-watcher then triggers respawn,
	 *  and the stderr classifier's `lastError` (e.g. "Connection refused",
	 *  "Stream key invalid") is what the renderer toasts.
	 *
	 *  Catches the X-without-Producer-access failure mode: the TCP
	 *  socket connects, the RTMP handshake stalls, ffmpeg sits there
	 *  with stdin filling and never produces output. Default 8_000ms. */
	connectTimeoutMs?: number;
}

export interface Supervisor {
	/** Start ffmpeg and keep it alive. Resolves once the first spawn
	 *  succeeds (writes are ready). Throws on initial spawn failure
	 *  (won't retry — first failure is usually a config issue). */
	start(): Promise<void>;
	/** Stop the supervisor and any running ffmpeg. Idempotent. */
	stop(): Promise<void>;
	/** Push a WebM byte chunk into ffmpeg's stdin. Returns false if the
	 *  process is currently reconnecting (caller should drop or buffer). */
	write(chunk: Uint8Array): Promise<boolean>;
	/** Current lifecycle state. */
	getState(): EgressLifecycleState;
	/** Heartbeat — caller calls this on every observed progress frame
	 *  (i.e. when ffmpeg's `-progress pipe:1` reader sees a fresh
	 *  block ending in `progress=continue`). The watchdog uses this
	 *  to decide whether to kill a silent ffmpeg. No-op when stale-
	 *  timeout is disabled. */
	noteActivity(): void;
}

// Bun's child-process stdin is a FileSink (not a WritableStream), so we
// call .write() directly rather than .getWriter().write().
interface FileSinkLike {
	write(chunk: Uint8Array): number | Promise<number>;
	flush?(): number | Promise<number>;
	end(): number | Promise<number>;
}

interface ActiveProc {
	proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
	sink: FileSinkLike;
}

export function createEgressSupervisor(opts: SupervisorOptions): Supervisor {
	const initialDelay = opts.initialReconnectDelayMs ?? 2_000;
	const maxDelay = opts.maxReconnectDelayMs ?? 15 * 60 * 1000;
	const maxAttempts = opts.maxReconnectAttempts ?? 20;
	const staleTimeoutMs = opts.staleTimeoutMs ?? 10_000;
	const connectTimeoutMs = opts.connectTimeoutMs ?? 8_000;

	let state: EgressLifecycleState = { kind: "idle" };
	let active: ActiveProc | null = null;
	let stopRequested = false;
	/** Session-wide count of successful (settled) respawns. Survives
	 *  the live → reconnecting → live cycles so the renderer can show
	 *  "reconnected #3" honestly. Reset on each fresh start(). */
	let restartCount = 0;
	/** Restart counter to carry into the next `live` state once a
	 *  `starting` spawn promotes via first-progress. */
	let pendingRestarts = 0;
	/** Wall-clock of the last observed ffmpeg activity (progress frame).
	 *  -1 = not yet armed. The watchdog compares against this. */
	let lastActivityAt = -1;
	let watchdogTimer: ReturnType<typeof setInterval> | null = null;
	const abortController = new AbortController();

	const setState = (s: EgressLifecycleState): void => {
		state = s;
		opts.onState?.(s);
	};

	const armWatchdog = (): void => {
		if (staleTimeoutMs <= 0 && connectTimeoutMs <= 0) return;
		// Reset the timestamp on each fresh spawn so a slow first
		// frame doesn't immediately trigger a kill.
		lastActivityAt = Date.now();
		if (watchdogTimer !== null) return;
		// Check every 1s; granularity finer than that wastes wakeups
		// (a few seconds late is fine for a 10s threshold).
		watchdogTimer = setInterval(() => {
			const a = active;
			if (!a) return;
			// `starting` — never heard any progress yet. Kill if the
			// connect-timeout has elapsed so the renderer toasts the
			// classifier message instead of sitting on a fake LIVE pill.
			if (state.kind === "starting") {
				if (connectTimeoutMs <= 0) return;
				const sinceSpawn = Date.now() - state.sinceMs;
				if (sinceSpawn < connectTimeoutMs) return;
				try { a.proc.kill("SIGKILL"); } catch { /* may already be dead */ }
				return;
			}
			// `live` — kill on extended silence (RTMP receiver died but
			// ffmpeg's TCP buffer absorbed writes).
			if (state.kind !== "live") return;
			if (staleTimeoutMs <= 0) return;
			if (lastActivityAt < 0) return;
			const idleMs = Date.now() - lastActivityAt;
			if (idleMs < staleTimeoutMs) return;
			lastActivityAt = -1;
			try { a.proc.kill("SIGKILL"); } catch { /* may already be dead */ }
		}, 1_000);
	};

	const disarmWatchdog = (): void => {
		if (watchdogTimer !== null) {
			clearInterval(watchdogTimer);
			watchdogTimer = null;
		}
		lastActivityAt = -1;
	};

	const spawnOnce = (): ActiveProc => {
		const [bin, ...rest] = opts.args;
		if (!bin) throw new Error("supervisor: empty args");
		const proc = Bun.spawn([bin, ...rest], {
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
			env: opts.env,
		}) as Bun.Subprocess<"pipe", "pipe", "pipe">;
		const sink = proc.stdin as unknown as FileSinkLike;
		opts.onStdout?.(proc);
		opts.onStderr?.(proc);
		return { proc, sink };
	};

	/** Spawn + wait a short window to confirm the process didn't die
	 *  immediately. ffmpeg with bad args (unknown encoder, missing
	 *  driver, malformed URL) typically dies in 50-200ms; ffmpeg that
	 *  successfully starts streaming stays alive indefinitely. We want
	 *  the immediate-deaths to count as spawn failures (so backoff
	 *  retries with different state) rather than as "live" sessions
	 *  that immediately exit. 200ms is the empirical sweet spot:
	 *  long enough to catch the bad-arg path, short enough not to
	 *  delay Go-Live perception. */
	const spawnAndSettle = async (settleMs = 200): Promise<ActiveProc> => {
		const ap = spawnOnce();
		// Race the proc's `exited` against a short settle timeout. If it
		// exits within the window, treat as failed spawn.
		let exitedFast = false;
		const winner = await Promise.race([
			ap.proc.exited.then((code) => {
				exitedFast = true;
				return code;
			}),
			new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), settleMs)),
		]);
		if (exitedFast) {
			const code = winner as number;
			throw new Error(`ffmpeg exited code=${code} within ${settleMs}ms of spawn`);
		}
		return ap;
	};

	const respawnLoop = async (lastError: string): Promise<void> => {
		if (stopRequested) return;
		setState({
			kind: "reconnecting",
			attempt: 1,
			sinceMs: Date.now(),
			lastError,
		});
		try {
			let attempt = 0;
			await withBackoff(
				async () => {
					attempt += 1;
					setState({
						kind: "reconnecting",
						attempt,
						sinceMs: Date.now(),
						lastError,
					});
					if (stopRequested) throw new Error("stopped");
					active = await spawnAndSettle();
					attachExitWatcher(active.proc);
					restartCount += 1;
					// Land in `starting` — `noteActivity` will promote to
					// `live` once ffmpeg emits its first progress block.
					// The `restarts` counter is preserved across the
					// promotion via `pendingRestarts`.
					pendingRestarts = restartCount;
					setState({ kind: "starting", sinceMs: Date.now() });
					armWatchdog();
				},
				{
					maxAttempts,
					initialDelayMs: initialDelay,
					maxDelayMs: maxDelay,
					signal: abortController.signal,
					onAttemptFailed: () => {
						active = null;
					},
				},
			);
		} catch (err) {
			active = null;
			disarmWatchdog();
			const message = err instanceof Error ? err.message : String(err);
			setState({
				kind: "failed",
				sinceMs: Date.now(),
				lastError: message,
			});
		}
	};

	const attachExitWatcher = (proc: Bun.Subprocess<"pipe", "pipe", "pipe">): void => {
		void (async () => {
			const code = await proc.exited;
			if (active?.proc !== proc) return; // already replaced
			active = null;
			if (stopRequested) {
				setState({ kind: "idle" });
				return;
			}
			// Code 0 and 255 = clean exit (SIGINT). Don't reconnect — the
			// caller stopped intentionally. Anything else is a crash;
			// kick off the respawn loop.
			if (code === 0 || code === 255) {
				setState({ kind: "idle" });
				return;
			}
			void respawnLoop(`ffmpeg exited code=${code}`);
		})();
	};

	return {
		async start(): Promise<void> {
			if (state.kind !== "idle") {
				throw new Error("supervisor: start() called while not idle");
			}
			stopRequested = false;
			restartCount = 0;
			pendingRestarts = 0;
			active = await spawnAndSettle();
			attachExitWatcher(active.proc);
			setState({ kind: "starting", sinceMs: Date.now() });
			armWatchdog();
		},

		async stop(): Promise<void> {
			stopRequested = true;
			abortController.abort();
			disarmWatchdog();
			const a = active;
			active = null;
			if (a) {
				try { await a.sink.end(); } catch { /* sink may be broken */ }
				try { a.proc.kill("SIGINT"); } catch { /* may already be dead */ }
				try { await a.proc.exited; } catch { /* drained */ }
			}
			setState({ kind: "idle" });
		},

		async write(chunk: Uint8Array): Promise<boolean> {
			if (!active) return false;
			try {
				await active.sink.write(chunk);
				return true;
			} catch {
				// Writer error is the canonical signal that ffmpeg died.
				// Don't escalate here; the exit-watcher will trigger
				// respawn. Just report a clean "not now".
				return false;
			}
		},

		getState(): EgressLifecycleState {
			return state;
		},

		noteActivity(): void {
			if (staleTimeoutMs > 0) {
				lastActivityAt = Date.now();
			}
			// First progress block — promote `starting` → `live`. This is
			// the only signal that bytes actually reached the RTMP
			// receiver, so it's also the only signal the renderer should
			// trust to say "you're live."
			if (state.kind === "starting") {
				setState({
					kind: "live",
					sinceMs: Date.now(),
					restarts: pendingRestarts,
				});
			}
		},
	};
}
