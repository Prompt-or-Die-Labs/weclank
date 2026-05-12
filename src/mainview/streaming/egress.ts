// Renderer-side egress controller. The stream-engine composites the active
// scene onto a canvas; we wrap that with a MediaRecorder, slice it into
// 1-second WebM blobs, base64-encode each, and ship to the Bun side which
// hands them to ffmpeg over stdin.
//
// Defaults to the 720p preset — that's our target for the low-strain
// developer-streaming use case (full 1080p doubles encoder cost for
// imperceptible gain at typical viewer scale).

import { streamEngine } from "./stream-engine";
import { bunRpc } from "../rpc";
import { studio } from "../state/studio-store";
import { IpcError, StudioError } from "../core/errors";
import { arrayBufferToBase64 } from "./base64";
import { startBroadcastCapture, type BroadcastCaptureSession } from "./capture";

const CHUNK_INTERVAL_MS = 1_000;

export interface EgressTarget {
	rtmpUrl: string;
	streamKey: string;
}

class EgressController {
	private capture: BroadcastCaptureSession | null = null;
	private busy = false;

	/** Accepts one OR many destinations. With multiple, Bun's ffmpeg
	 * `tee` muxer fans the same encode out to all of them. */
	async start(targets: EgressTarget | EgressTarget[]): Promise<void> {
		if (this.capture) throw new StudioError("Egress already started", "Stop the current stream before starting a new one.");

		const destinations = Array.isArray(targets) ? targets : [targets];
		if (destinations.length === 0) {
			throw new StudioError("No destinations", "Add at least one RTMP destination before going live.");
		}

		const begin = await bunRpc.startStreamEgress({ destinations });
		if (!begin.success) {
			throw new IpcError(begin.error || "Bun rejected the egress start", begin.error || "Couldn't start the local ffmpeg process. Is ffmpeg on PATH?");
		}

		try {
			this.capture = startBroadcastCapture({
				source: streamEngine,
				quality: studio.state.stream.quality,
				chunkIntervalMs: CHUNK_INTERVAL_MS,
				onChunk: (blob) => { void this.shipChunk(blob); },
				onError: (event) => {
					console.error("[egress] recorder error", event);
				},
			});
		} catch (err) {
			await bunRpc.stopStreamEgress({});
			throw err;
		}
	}

	async stop(): Promise<void> {
		const capture = this.capture;
		this.capture = null;
		await capture?.stop();
		try {
			await bunRpc.stopStreamEgress({});
		} catch (err) {
			console.warn("[egress] stop RPC failed", err);
		}
	}

	private async shipChunk(blob: Blob): Promise<void> {
		while (this.busy) await new Promise((r) => setTimeout(r, 5));
		this.busy = true;
		try {
			const buffer = await blob.arrayBuffer();
			const base64 = arrayBufferToBase64(buffer);
			const result = await bunRpc.pushStreamChunk({ base64 });
			if (!result.ok) {
				console.warn("[egress] chunk rejected", result.error);
			}
		} finally {
			this.busy = false;
		}
	}
}

export const egressController = new EgressController();
