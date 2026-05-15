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
import { arrayBufferToBase64 } from "./base64";
import { broadcastCapture, type CaptureSink } from "./capture";

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

		const begin = await bunRpc.startStreamEgress({ destinations });
		if (!begin.success) {
			throw new IpcError(begin.error || "Bun rejected the egress start", begin.error || "Couldn't start the local ffmpeg process. Is ffmpeg on PATH?");
		}

		this.writeChain = Promise.resolve();
		const sink: CaptureSink = {
			id: EGRESS_SINK_ID,
			onChunk: (blob) => {
				this.writeChain = this.writeChain
					.then(() => this.shipChunk(blob))
					.catch((err) => console.warn("[egress] chunk push failed", err));
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
		} catch (err) {
			await bunRpc.stopStreamEgress({});
			throw err;
		}
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
			console.warn("[egress] capture detach failed", err);
		}
		try {
			await bunRpc.stopStreamEgress({});
		} catch (err) {
			console.warn("[egress] stop RPC failed", err);
		}
	}

	private async shipChunk(blob: Blob): Promise<void> {
		const buffer = await blob.arrayBuffer();
		const base64 = arrayBufferToBase64(buffer);
		const result = await bunRpc.pushStreamChunk({ base64 });
		if (!result.ok) {
			console.warn("[egress] chunk rejected", result.error);
		}
	}
}

export const egressController = new EgressController();
