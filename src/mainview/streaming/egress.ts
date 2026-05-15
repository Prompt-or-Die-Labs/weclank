// Renderer-side egress controller. The stream-engine composites the active
// scene onto a canvas; we wrap that with a MediaRecorder, slice it into
// 1-second WebM blobs, base64-encode each, and ship to the Bun side which
// hands them to ffmpeg over stdin.
//
// Like the local recorder, `stop()` is fire-and-forget: the UI flips off
// LIVE immediately and ffmpeg shuts down in the background. The user
// never waits on the encoder to click again.

import { streamEngine } from "./stream-engine";
import { bunRpc } from "../rpc";
import { studio } from "../state/studio-store";
import { IpcError, StudioError } from "../core/errors";
import { withBackoff } from "../../shared/retry";
import { arrayBufferToBase64 } from "./base64";
import { broadcastCapture, type CaptureSink } from "./capture";
import { PRESETS } from "./presets";
import { logger, metrics, setBroadcastSessionId, timed } from "../observability";
import { replayBuffer } from "./replay-buffer";

const CHUNK_INTERVAL_MS = 1_000;
const EGRESS_SINK_ID = "egress";

export interface EgressTarget {
	rtmpUrl: string;
	streamKey: string;
}

class EgressController {
	private attached = false;
	private writeChain: Promise<void> = Promise.resolve();
	private shutdownInFlight: Promise<void> | null = null;

	/** Accepts one OR many destinations. With multiple, Bun's ffmpeg
	 * `tee` muxer fans the same encode out to all of them. */
	async start(targets: EgressTarget | EgressTarget[]): Promise<void> {
		if (this.shutdownInFlight) await this.shutdownInFlight;
		if (this.attached) throw new StudioError("Egress already started", "Stop the current stream before starting a new one.");

		const destinations = Array.isArray(targets) ? targets : [targets];
		if (destinations.length === 0) {
			throw new StudioError("No destinations", "Add at least one RTMP destination before going live.");
		}

		// Mint a session id so every log / metric / banter event during
		// this broadcast carries the same correlation key.
		const sessionId = `bx-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
		setBroadcastSessionId(sessionId);

		// Bun's ffmpeg picks its own (wrong) defaults if fps + bitrate
		// don't come through with the start call. Pass them explicitly
		// from the active preset.
		const preset = PRESETS[studio.state.stream.quality];
		const log = logger().withFields({
			component: "egress",
			quality: studio.state.stream.quality,
			destinations: destinations.length,
		});
		log.info("starting egress");

		const begin = await timed("egress_start", () =>
			bunRpc.startStreamEgress({
				destinations,
				fps: preset.fps,
				videoBitsPerSecond: preset.videoBitsPerSecond,
				audioBitsPerSecond: preset.audioBitsPerSecond,
			}),
		);
		if (!begin.success) {
			metrics().incrementCounter("egress_start_failures_total");
			setBroadcastSessionId(undefined);
			throw new IpcError(begin.error || "Bun rejected the egress start", begin.error || "Couldn't start the local ffmpeg process. Is ffmpeg on PATH?");
		}
		metrics().incrementCounter("egress_starts_total", {
			destinations: String(destinations.length),
		});

		this.writeChain = Promise.resolve();
		const sink: CaptureSink = {
			id: EGRESS_SINK_ID,
			onChunk: (blob) => {
				this.writeChain = this.writeChain
					.then(() => this.shipChunk(blob))
					.catch((err) => logger().withError(err).warn("chunk push failed"));
			},
			onError: (err) => {
				// MediaRecorder died mid-stream — chunks have stopped
				// flowing. Surface immediately so the user knows the
				// LIVE pill is lying. Egress will tear down on the
				// existing capture-detach path.
				metrics().incrementCounter("egress_capture_errors_total");
				logger().withError(err).error("MediaRecorder error — broadcast halted");
				void this.stopOnRecorderError(err);
			},
			onStop: async () => {
				await this.writeChain;
			},
		};

		try {
			await broadcastCapture.attach(sink, {
				source: streamEngine,
				quality: studio.state.stream.quality,
				chunkIntervalMs: CHUNK_INTERVAL_MS,
			});
			this.attached = true;
			log.info("egress live");
			// Arm the replay buffer alongside egress. Awaiting so a
			// failure to attach surfaces immediately rather than being
			// silently swallowed by a fire-and-forget Promise. A
			// broken buffer doesn't break the stream — degrade
			// gracefully with a warn — but the *failure to know* is
			// what the advisor caught.
			try {
				await replayBuffer.attach(streamEngine, studio.state.stream.quality);
			} catch (err) {
				logger().withError(err).warn("replay-buffer attach failed; stream continues without it");
				metrics().incrementCounter("replay_buffer_attach_failures_total");
			}
		} catch (err) {
			metrics().incrementCounter("egress_attach_failures_total");
			await bunRpc.stopStreamEgress({});
			setBroadcastSessionId(undefined);
			throw err;
		}
	}

	/** Triggered by capture.onError. Tear down + surface a toast so the
	 *  user doesn't keep believing the broadcast is live. */
	private async stopOnRecorderError(err: Error): Promise<void> {
		try {
			const { toast } = await import("../components/overlays");
			toast(`Broadcast halted — capture failed: ${err.message}`, "error");
		} catch { /* lazy import failed; skip the toast */ }
		this.stop();
	}

	/** Fire-and-forget. Live=false flips immediately; ffmpeg drains in background. */
	stop(): void {
		if (!this.attached) {
			studio.setStream({ live: false });
			return;
		}
		this.attached = false;
		studio.setStream({ live: false });
		const shutdown = this.shutdown().finally(() => {
			if (this.shutdownInFlight === shutdown) this.shutdownInFlight = null;
		});
		this.shutdownInFlight = shutdown;
		void shutdown;
	}

	private async shutdown(): Promise<void> {
		try {
			await broadcastCapture.detach(EGRESS_SINK_ID);
		} catch (err) {
			logger().withError(err).warn("capture detach failed");
		}
		try {
			await replayBuffer.detach();
		} catch (err) {
			logger().withError(err).warn("replay-buffer detach failed");
		}
		try {
			await bunRpc.stopStreamEgress({});
		} catch (err) {
			logger().withError(err).warn("stop RPC failed");
		}
		logger().info("egress stopped");
		setBroadcastSessionId(undefined);
	}

	private async shipChunk(blob: Blob): Promise<void> {
		const buffer = await blob.arrayBuffer();
		const base64 = arrayBufferToBase64(buffer);
		// Up to 3 attempts with decorrelated-jitter backoff. A single
		// transient Bun-side error (process briefly busy, RPC bus blip)
		// used to silently drop 1s of video; this preserves it. After 3
		// attempts the chunk is given up — losing 1s is preferable to
		// stalling the rest of the broadcast.
		try {
			await withBackoff(
				async () => {
					const result = await bunRpc.pushStreamChunk({ base64 });
					if (!result.ok) {
						throw new IpcError(
							result.error || "chunk rejected",
							"Stream hiccup — retrying.",
						);
					}
					return result;
				},
				{
					maxAttempts: 3,
					initialDelayMs: 200,
					maxDelayMs: 2_000,
					onAttemptFailed: (n, err) => {
						metrics().incrementCounter("egress_chunk_retry_attempts_total", { attempt: String(n) });
						logger().withError(err).warn(`chunk attempt ${n} failed`);
					},
				},
			);
			metrics().addCounter("egress_chunk_bytes_total", buffer.byteLength);
			metrics().incrementCounter("egress_chunks_total");
		} catch (err) {
			metrics().incrementCounter("egress_chunk_rejects_total");
			logger().withError(err).warn("chunk rejected after retries");
		}
	}
}

export const egressController = new EgressController();
