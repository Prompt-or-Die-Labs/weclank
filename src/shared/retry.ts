// Exponential-backoff retry helper. Used everywhere we hit the network:
// Twitch IRC reconnect, transcript watcher reattach, music fetch, etc.
//
// The backoff is decorrelated jitter — each delay is a random value in
// [base, prev * 3] so a fleet of clients hitting the same outage don't
// thunderbolt the upstream on recovery.

export interface RetryOptions {
	maxAttempts?: number;
	initialDelayMs?: number;
	maxDelayMs?: number;
	signal?: AbortSignal;
	/** Called on every failure with the attempt number + the error.
	 * Default: console.warn. */
	onAttemptFailed?: (attempt: number, err: unknown) => void;
}

/** True for HTTP status codes that warrant a retry — 429 (rate limit)
 * and 5xx (transient server errors). 4xx other than 429 means the
 * request is malformed or unauthorized; no amount of retrying fixes that. */
export function isRetryableStatus(status: number): boolean {
	return status === 429 || (status >= 500 && status < 600);
}

export async function withBackoff<T>(
	operation: () => Promise<T>,
	opts: RetryOptions = {},
): Promise<T> {
	const maxAttempts = opts.maxAttempts ?? 5;
	const baseDelay = opts.initialDelayMs ?? 500;
	const maxDelay = opts.maxDelayMs ?? 30_000;
	const onFail = opts.onAttemptFailed ?? ((n, err) => console.warn(`[retry] attempt ${n} failed`, err));

	let lastErr: unknown;
	let prevDelay = baseDelay;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		if (opts.signal?.aborted) throw new Error("Aborted before retry");
		try {
			return await operation();
		} catch (err) {
			lastErr = err;
			onFail(attempt, err);
			if (attempt === maxAttempts) break;
			// Decorrelated jitter: next delay is random in [baseDelay, prev * 3], capped.
			const upperBound = Math.min(maxDelay, prevDelay * 3);
			const delay = Math.min(maxDelay, baseDelay + Math.random() * (upperBound - baseDelay));
			prevDelay = delay;
			await sleep(delay, opts.signal);
		}
	}
	throw lastErr;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) { reject(new Error("Aborted")); return; }
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener("abort", () => {
			clearTimeout(timer);
			reject(new Error("Aborted"));
		}, { once: true });
	});
}

/** Long-lived reconnect loop. Wraps a "stay connected" workflow where
 * each connection might drop and we should reconnect with backoff —
 * different from `withBackoff` which retries a single operation.
 *
 * The `runOnce` callback should resolve when the connection closes
 * cleanly (i.e. it's a long-running promise that lasts the connection's
 * lifetime). It should throw on error so we can backoff. The loop runs
 * until `signal` aborts. */
export async function reconnectLoop(
	runOnce: () => Promise<void>,
	opts: {
		initialDelayMs?: number;
		maxDelayMs?: number;
		signal: AbortSignal;
		label?: string;
		/** Called when runOnce throws. Default: console.warn. Tests pass
		 * a no-op to keep output clean. */
		onDrop?: (err: unknown) => void;
	} = {} as never,
): Promise<void> {
	const base = opts.initialDelayMs ?? 1_000;
	const max = opts.maxDelayMs ?? 30_000;
	const onDrop = opts.onDrop ?? ((err) => console.warn(`[reconnect${opts.label ? ` ${opts.label}` : ""}] dropped, retrying`, err));
	let prevDelay = base;
	while (!opts.signal?.aborted) {
		try {
			await runOnce();
			// Clean exit — drop the backoff back to base for the next attempt.
			prevDelay = base;
		} catch (err) {
			if (opts.signal?.aborted) return;
			onDrop(err);
		}
		if (opts.signal?.aborted) return;
		const upper = Math.min(max, prevDelay * 3);
		const delay = base + Math.random() * (upper - base);
		prevDelay = Math.min(max, delay);
		try { await sleep(delay, opts.signal); } catch { return; }
	}
}
