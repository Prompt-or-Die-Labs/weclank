// Broadcast capture — per CONTEXT.md, ONE concept: "the MediaRecorder
// pipeline that captures the broadcast canvas plus mixed audio for local
// recording or RTMP egress."
//
// There is ONE shared MediaRecorder. Consumers register a `CaptureSink`
// and receive every chunk; when the last sink detaches the recorder stops.
// Each consumer keeps its own destination logic (file write vs. ffmpeg
// stdin) inside the sink — the seam is at the chunk stream, not at the
// MediaRecorder.

import type { StreamQuality } from "../core/types";
import { PRESETS, pickSupportedMime } from "./presets";

export interface BroadcastStreamSource {
	setResolution(width: number, height: number): void;
	setTargetFps(fps: number): void;
	getOutputStream(fps: number): MediaStream;
}

export interface CaptureMeta {
	readonly mimeType: string;
	readonly quality: StreamQuality;
	readonly chunkIntervalMs: number;
}

export interface CaptureSink {
	readonly id: string;
	/** Notified once when the session starts. The sink may capture meta
	 * (mime / quality) here for downstream use. */
	onStart?(meta: CaptureMeta): void | Promise<void>;
	/** Called for every chunk while attached. Must not throw — the
	 * capture loop catches and logs, but a thrown sink could block other
	 * sinks behind it. */
	onChunk(blob: Blob): void;
	/** Called once when the sink is detached OR the session is shutting
	 * down. The sink should flush any pending writes here. */
	onStop(): void | Promise<void>;
}

interface InternalSession {
	source: BroadcastStreamSource;
	recorder: MediaRecorder;
	mimeType: string;
	chunkIntervalMs: number;
	quality: StreamQuality;
	flushTimer: ReturnType<typeof setInterval>;
	sinks: Map<string, CaptureSink>;
	/** Last shutdown promise so concurrent stops await the same teardown. */
	stopping: Promise<void> | null;
}

/** Single shared session — null when no sink is attached. */
class BroadcastCapture {
	private session: InternalSession | null = null;

	/** Test-only: force the singleton back to a clean state. The
	 * production code never needs this — production callers detach
	 * sinks through normal lifecycle. Tests that swap the MediaRecorder
	 * fake between cases must call this in their setup so the new fake
	 * is actually used, otherwise the singleton hands them an old
	 * session attached to a torn-down recorder. */
	_resetForTesting(): void {
		this.session = null;
	}

	get isActive(): boolean { return this.session !== null; }
	get mimeType(): string | null { return this.session?.mimeType ?? null; }
	/** Sink ids currently attached — useful for diagnostics. */
	get attachedSinkIds(): string[] { return this.session ? Array.from(this.session.sinks.keys()) : []; }

	/** Attach a sink. Starts the underlying MediaRecorder if not already
	 * running. If the session is already running with different options,
	 * the existing session wins — quality/chunk settings are honored from
	 * the FIRST attach, so later sinks must accept what's already there.
	 * (In practice both call sites use the same studio.state.stream.quality
	 * and the same 1s chunk interval.)
	 *
	 * The synchronous path: the MediaRecorder is constructed and starts
	 * BEFORE attach() returns. The optional `sink.onStart` callback is
	 * awaited on the returned promise. */
	async attach(
		sink: CaptureSink,
		opts: { source: BroadcastStreamSource; quality: StreamQuality; chunkIntervalMs: number },
	): Promise<CaptureMeta> {
		const session = this.ensureSessionSync(opts);
		if (session.sinks.has(sink.id)) {
			throw new Error(`Capture sink "${sink.id}" already attached`);
		}
		session.sinks.set(sink.id, sink);
		const meta: CaptureMeta = {
			mimeType: session.mimeType,
			quality: session.quality,
			chunkIntervalMs: session.chunkIntervalMs,
		};
		try {
			await sink.onStart?.(meta);
		} catch (err) {
			session.sinks.delete(sink.id);
			throw err;
		}
		return meta;
	}

	/** Detach a sink.
	 *
	 * Drain semantics: when this sink is the last one, the recorder is
	 * stopped FIRST (which fires one final `dataavailable` with whatever
	 * was buffered), then the sink receives that final chunk via its
	 * normal `onChunk`, then `onStop` is called. This matches MediaRecorder
	 * teardown behavior — callers rely on the post-stop chunk to finalize
	 * their writes.
	 *
	 * When other sinks remain, this sink is removed immediately and its
	 * `onStop` is called — the recorder keeps running for the others. */
	async detach(sinkId: string): Promise<void> {
		const session = this.session;
		if (!session) return;
		const sink = session.sinks.get(sinkId);
		if (!sink) return;

		if (session.sinks.size === 1) {
			// Last sink — drain through it before removing.
			await this.shutdown(session);
			session.sinks.delete(sinkId);
		} else {
			session.sinks.delete(sinkId);
		}
		try {
			await sink.onStop();
		} catch (err) {
			console.warn(`[capture] sink "${sinkId}" onStop threw`, err);
		}
	}

	private ensureSessionSync(opts: {
		source: BroadcastStreamSource;
		quality: StreamQuality;
		chunkIntervalMs: number;
	}): InternalSession {
		if (this.session) return this.session;
		const session = this.createSession(opts);
		this.session = session;
		return session;
	}

	private createSession(opts: {
		source: BroadcastStreamSource;
		quality: StreamQuality;
		chunkIntervalMs: number;
	}): InternalSession {
		const preset = PRESETS[opts.quality];
		const mimeType = pickSupportedMime(preset.mimeType);
		opts.source.setResolution(preset.width, preset.height);
		opts.source.setTargetFps(preset.fps);
		const stream = opts.source.getOutputStream(preset.fps);
		const recorder = new MediaRecorder(stream, {
			mimeType,
			videoBitsPerSecond: preset.videoBitsPerSecond,
			audioBitsPerSecond: preset.audioBitsPerSecond,
		});
		const session: InternalSession = {
			source: opts.source,
			recorder,
			mimeType,
			chunkIntervalMs: opts.chunkIntervalMs,
			quality: opts.quality,
			flushTimer: undefined as unknown as ReturnType<typeof setInterval>,
			sinks: new Map(),
			stopping: null,
		};
		const onDataAvailable = (event: BlobEvent): void => {
			if (event.data.size === 0) return;
			for (const sink of session.sinks.values()) {
				try { sink.onChunk(event.data); } catch (err) { console.warn(`[capture] sink "${sink.id}" onChunk threw`, err); }
			}
		};
		recorder.addEventListener("dataavailable", onDataAvailable as EventListener);
		recorder.addEventListener("error", (event) => {
			console.error("[capture] MediaRecorder error", event);
		});
		recorder.start(opts.chunkIntervalMs);
		session.flushTimer = setInterval(() => {
			if (recorder.state !== "recording") return;
			try {
				recorder.requestData();
			} catch {
				// Stop path does one final request; ignore transient refusal.
			}
		}, opts.chunkIntervalMs);
		return session;
	}

	private async shutdown(session: InternalSession): Promise<void> {
		if (session.stopping) {
			await session.stopping;
			return;
		}
		const promise = this.runShutdown(session);
		session.stopping = promise;
		try {
			await promise;
		} finally {
			if (this.session === session) this.session = null;
		}
	}

	private async runShutdown(session: InternalSession): Promise<void> {
		clearInterval(session.flushTimer);
		await stopRecorder(session.recorder);
	}
}

export const broadcastCapture = new BroadcastCapture();

function stopRecorder(recorder: MediaRecorder): Promise<void> {
	if (recorder.state === "inactive") return Promise.resolve();
	return new Promise<void>((resolve) => {
		let stopped = false;
		let dataAvailable = false;
		let fallback: ReturnType<typeof setTimeout> | null = null;
		const finish = (): void => {
			if (fallback) clearTimeout(fallback);
			recorder.removeEventListener("dataavailable", onDataAvailable);
			resolve();
		};
		const maybeFinish = (): void => {
			if (stopped && dataAvailable) finish();
		};
		const onDataAvailable = (): void => {
			dataAvailable = true;
			maybeFinish();
		};
		recorder.addEventListener("dataavailable", onDataAvailable, { once: true });
		recorder.addEventListener("stop", () => {
			stopped = true;
			// 1500ms upper bound for the final dataavailable after stop().
			// Real MediaRecorders usually flush within ~100ms; we err long
			// so a slow flush (or a test fake with a delay) doesn't cut
			// off the recording's last chunk before recorder.ts can drain.
			fallback = setTimeout(finish, 1500);
			maybeFinish();
		}, { once: true });
		try {
			recorder.requestData();
			recorder.stop();
		} catch {
			finish();
		}
	});
}
