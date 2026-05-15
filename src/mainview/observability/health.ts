// Parallel health aggregator. Required checks gate `unhealthy`; optional
// checks only escalate to `degraded`. Per-check timeout via AbortController
// so a hung check doesn't gum up the report.
//
// Required (when stream.live): ffmpeg-alive, audio-context running,
// active-scene non-empty. Optional: twitch IRC, banter session,
// transcription stream, music player.

export type Status = "healthy" | "degraded" | "unhealthy";

export type CheckFunc = (signal: AbortSignal) => Promise<void>;

export interface ComponentResult {
	name: string;
	status: Status;
	message?: string;
	durationMs: number;
	lastChecked: number;
}

export interface Report {
	status: Status;
	components: ComponentResult[];
	timestamp: number;
}

interface RegisteredCheck {
	name: string;
	required: boolean;
	check: CheckFunc;
}

export interface HealthAggregatorOptions {
	/** Per-check timeout. Default 3s. */
	timeoutMs?: number;
}

export class HealthAggregator {
	private readonly checks = new Map<string, RegisteredCheck>();
	private readonly timeoutMs: number;

	constructor(opts: HealthAggregatorOptions = {}) {
		this.timeoutMs = opts.timeoutMs ?? 3_000;
	}

	register(name: string, check: CheckFunc): void {
		this.checks.set(name, { name, required: true, check });
	}

	registerOptional(name: string, check: CheckFunc): void {
		this.checks.set(name, { name, required: false, check });
	}

	unregister(name: string): void {
		this.checks.delete(name);
	}

	listRegistered(): string[] {
		return Array.from(this.checks.keys());
	}

	async check(): Promise<Report> {
		const t0 = Date.now();
		const components = await Promise.all(
			Array.from(this.checks.values()).map((c) => this.runOne(c)),
		);
		const status = this.aggregate(components);
		return { status, components, timestamp: t0 };
	}

	private async runOne(c: RegisteredCheck): Promise<ComponentResult> {
		const start = Date.now();
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.timeoutMs);
		try {
			await c.check(controller.signal);
			return {
				name: c.name,
				status: "healthy",
				durationMs: Date.now() - start,
				lastChecked: start,
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return {
				name: c.name,
				status: c.required ? "unhealthy" : "degraded",
				message,
				durationMs: Date.now() - start,
				lastChecked: start,
			};
		} finally {
			clearTimeout(timer);
		}
	}

	private aggregate(components: ComponentResult[]): Status {
		let worst: Status = "healthy";
		for (const c of components) {
			if (c.status === "unhealthy") return "unhealthy";
			if (c.status === "degraded") worst = "degraded";
		}
		return worst;
	}
}

// ---------------------------------------------------------------------------
// Pre-built check factories. Wire from app bootstrap.
// ---------------------------------------------------------------------------

/** Throws if the AudioContext is not running (suspended/closed/interrupted). */
export function audioContextCheck(getCtx: () => AudioContext): CheckFunc {
	return async () => {
		const ctx = getCtx();
		if (ctx.state === "running") return;
		throw new Error(`AudioContext state=${ctx.state}`);
	};
}

/** Throws if the active scene has zero sources. */
export function activeSceneNonEmptyCheck(getCount: () => number): CheckFunc {
	return async () => {
		const n = getCount();
		if (n > 0) return;
		throw new Error("Active scene is empty");
	};
}

/** Pings the supplied probe and asserts ffmpeg is alive. Probe returns
 *  true when egress is running and the ffmpeg subprocess is healthy. */
export function ffmpegAliveCheck(probe: () => Promise<boolean>): CheckFunc {
	return async () => {
		const ok = await probe();
		if (!ok) throw new Error("ffmpeg process not alive");
	};
}

// ---------------------------------------------------------------------------
// Singleton.
// ---------------------------------------------------------------------------

let _aggregator: HealthAggregator | undefined;

export function setHealthAggregator(a: HealthAggregator): void {
	_aggregator = a;
}

export function health(): HealthAggregator {
	if (!_aggregator) _aggregator = new HealthAggregator();
	return _aggregator;
}
