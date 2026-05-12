// Polls the Bun-side transcript watcher every ~1.5s and exposes the
// recent events to the banter engine. We intentionally don't push events
// — the banter LLM call happens AT MOST every 6s anyway (cooldown), so
// 1.5s polling is plenty fresh.
//
// The feed is a singleton: one watcher per studio. When two banter agents
// both want transcript context, they share the same feed.

import { bunRpc } from "../rpc";
import { studio } from "../state/studio-store";
import { IpcError } from "../core/errors";

interface TranscriptEvent {
	seq: number;
	ts: number;
	kind: string;
	summary: string;
}

const POLL_INTERVAL_MS = 1_500;
const RING_SIZE = 100;

class TranscriptFeed {
	private events: TranscriptEvent[] = [];
	private sinceSeq = 0;
	private timer: ReturnType<typeof setInterval> | null = null;
	private active = false;
	private path: string | null = null;

	async start(path: string): Promise<void> {
		if (this.active && this.path === path) return;
		await this.stop();
		this.path = path;
		this.sinceSeq = 0;
		this.events = [];
		const result = await bunRpc.startTranscriptWatch({ path });
		if (!result.success) {
			throw new IpcError(
				result.error || "Couldn't start transcript watch",
				result.error || "Couldn't start watching that session file. Check the path exists and is readable.",
			);
		}
		this.active = true;
		this.timer = setInterval(() => void this.tick(), POLL_INTERVAL_MS);
	}

	async stop(): Promise<void> {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
		if (this.active) {
			try { await bunRpc.stopTranscriptWatch({}); } catch { /* noop */ }
		}
		this.active = false;
		this.path = null;
	}

	isActive(): boolean {
		return this.active;
	}

	/** Last N event summaries formatted for LLM consumption. */
	recentSummaries(limit = 8): string[] {
		return this.events
			.slice(-limit)
			.map((e) => `- ${tagFor(e.kind)} ${e.summary}`);
	}

	/** Sequence number of the most recent event (0 when empty). Used by
	 * banter sessions to detect "new since last check". */
	currentMaxSeq(): number {
		const last = this.events[this.events.length - 1];
		return last?.seq ?? 0;
	}

	/** Summaries that appeared after the given sequence number. Used by
	 * the idle-trigger path in the banter engine — distinct from
	 * recentSummaries because we want only the unseen events, not the
	 * trailing window. */
	summariesSince(seq: number, limit = 8): string[] {
		return this.events
			.filter((e) => e.seq > seq)
			.slice(-limit)
			.map((e) => `- ${tagFor(e.kind)} ${e.summary}`);
	}

	/** Test hook — seed events without going through the RPC poll path.
	 * Replaces the current ring; production callers shouldn't touch this. */
	__seedForTesting(events: TranscriptEvent[]): void {
		this.events = [...events];
	}

	private async tick(): Promise<void> {
		try {
			const result = await bunRpc.pollTranscriptEvents({ sinceSeq: this.sinceSeq });
			for (const e of result.events) this.events.push(e);
			if (this.events.length > RING_SIZE) {
				this.events = this.events.slice(-RING_SIZE);
			}
			this.sinceSeq = result.nextSeq;
		} catch (err) {
			console.warn("[transcript] poll failed", err);
		}
	}
}

function tagFor(kind: string): string {
	if (kind === "assistant_tool") return "[tool]";
	if (kind === "assistant_text") return "[said]";
	return "[event]";
}

export const transcriptFeed = new TranscriptFeed();

/** Apply a transcript config to the feed — starts/stops as needed. Idempotent. */
export async function syncTranscriptFeed(): Promise<void> {
	const config = studio.state.transcript;
	if (config?.enabled && config.path) {
		try {
			await transcriptFeed.start(config.path);
		} catch (err) {
			console.warn("[transcript] start failed", err);
		}
	} else {
		await transcriptFeed.stop();
	}
}
