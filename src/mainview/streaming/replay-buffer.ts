// Replay buffer — keeps the last N seconds of broadcast in memory as
// a ring of WebM chunks. On `save()`, the chunks are concatenated and
// returned as a single WebM Blob ready to hand to a save dialog or
// the local-recording transcode pipeline.
//
// Why an in-memory ring (not disk): chunks are 1s at 2.5 Mbps =
// ~300 KB each. 60s = ~18 MB. That fits comfortably in renderer memory
// without disk I/O, and the buffer can be cleanly torn down when the
// broadcast ends.
//
// Attaches as a CaptureSink — never spawns its own MediaRecorder.
// Free-rides on the existing broadcastCapture singleton, so memory
// pressure is bounded and the buffered footage matches exactly what
// the live broadcast emitted.

import { broadcastCapture, type CaptureMeta, type CaptureSink } from "./capture";
import { logger, metrics } from "../observability";

export interface ReplayBufferOptions {
	/** Buffer window in seconds. Default 60s — long enough to save
	 *  "the last great moment" without burning memory. */
	windowSeconds?: number;
}

export class ReplayBuffer implements CaptureSink {
	readonly id = "replay-buffer";

	private chunks: Blob[] = [];
	private mimeType = "";
	private chunkIntervalMs = 1_000;
	private windowSeconds: number;
	private attached = false;

	constructor(opts: ReplayBufferOptions = {}) {
		this.windowSeconds = Math.max(5, opts.windowSeconds ?? 60);
	}

	get isAttached(): boolean { return this.attached; }
	get bufferedChunks(): number { return this.chunks.length; }
	get bufferedBytes(): number { return this.chunks.reduce((sum, b) => sum + b.size, 0); }
	get bufferedSeconds(): number {
		if (this.chunkIntervalMs <= 0) return 0;
		return (this.chunks.length * this.chunkIntervalMs) / 1000;
	}

	/** Begin buffering. Idempotent — second start() while attached is
	 *  a no-op. */
	async attach(source: import("./capture").BroadcastStreamSource, quality: import("../core/types").StreamQuality): Promise<void> {
		if (this.attached) return;
		await broadcastCapture.attach(this, {
			source,
			quality,
			chunkIntervalMs: this.chunkIntervalMs,
		});
		this.attached = true;
		logger().withFields({ component: "replay-buffer", windowSec: this.windowSeconds }).info("replay buffer armed");
		metrics().incrementCounter("replay_buffer_armed_total");
	}

	/** Stop buffering and drop all chunks. */
	async detach(): Promise<void> {
		if (!this.attached) return;
		try {
			await broadcastCapture.detach(this.id);
		} finally {
			this.attached = false;
			this.chunks = [];
			logger().withField("component", "replay-buffer").info("replay buffer disarmed");
		}
	}

	/** Snapshot the current buffer as a single Blob without disarming.
	 *  Returns null if nothing's been captured yet. */
	snapshot(): { blob: Blob; mimeType: string; seconds: number } | null {
		if (this.chunks.length === 0 || !this.mimeType) return null;
		const seconds = this.bufferedSeconds;
		const blob = new Blob(this.chunks, { type: this.mimeType });
		metrics().incrementCounter("replay_buffer_snapshots_total");
		metrics().recordValue("replay_buffer_snapshot_bytes", blob.size);
		logger().withFields({
			component: "replay-buffer",
			bytes: blob.size,
			seconds,
		}).info("replay snapshot captured");
		return { blob, mimeType: this.mimeType, seconds };
	}

	// ---- CaptureSink implementation ----

	onStart(meta: CaptureMeta): void {
		this.mimeType = meta.mimeType;
		this.chunkIntervalMs = meta.chunkIntervalMs;
		// Drop any stale chunks from a previous attach.
		this.chunks = [];
	}

	onChunk(blob: Blob): void {
		this.chunks.push(blob);
		// Drop oldest until we're within the window.
		const maxChunks = Math.max(1, Math.ceil((this.windowSeconds * 1000) / this.chunkIntervalMs));
		while (this.chunks.length > maxChunks) {
			this.chunks.shift();
		}
		metrics().setGauge("replay_buffer_chunks", this.chunks.length);
		metrics().setGauge("replay_buffer_seconds", this.bufferedSeconds);
	}

	onError(err: Error): void {
		// MediaRecorder died — every chunk we already accumulated is
		// still valid WebM, but we'll get no more. Keep the buffer
		// so the user can still save what we captured, but log the
		// failure mode so it doesn't look like an inexplicable empty.
		metrics().incrementCounter("replay_buffer_capture_errors_total");
		logger().withError(err).warn("replay buffer: capture errored — keeping accumulated chunks");
	}

	onStop(): void {
		// onStop fires when the broadcast capture detaches us OR when
		// it tears down. In either case we drop the buffer so a fresh
		// attach starts clean.
		this.chunks = [];
		this.mimeType = "";
		metrics().setGauge("replay_buffer_chunks", 0);
		metrics().setGauge("replay_buffer_seconds", 0);
	}
}

/** Module-singleton. The shell wires it up on Go Live and tears it
 *  down on Stop. UI gets at it through this export. */
export const replayBuffer = new ReplayBuffer();
