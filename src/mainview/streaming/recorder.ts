// Local recorder — MediaRecorder encodes VP8/9 + Opus into WebM (same
// pipeline as RTMP egress). Chunks are streamed to a temp WebM in the
// system temp directory; on stop, Bun runs ffmpeg to transcode to H.264+AAC
// MP4 at the path you pick (+faststart for quick playback start).
//
// Independent of egress: you can record without streaming, stream
// without recording, or both at once. The recorder uses the same preset
// for resolution/bitrate so the file matches the broadcast.

import { streamEngine } from "./stream-engine";
import { studio } from "../state/studio-store";
import { bunRpc } from "../rpc";
import { AudioError, IpcError } from "../core/errors";
import { toast } from "../components/overlays";
import { arrayBufferToBase64 } from "./base64";
import { startBroadcastCapture, type BroadcastCaptureSession } from "./capture";

class LocalRecorder {
	private capture: BroadcastCaptureSession | null = null;
	private startedAt = 0;
	/** Serializes chunk writes so the last `dataavailable` blob finishes
	 * before `finishRecordingFile` closes the handle (MediaRecorder does
	 * not await `onChunk`). */
	private writeChain: Promise<void> = Promise.resolve();

	get isRecording(): boolean {
		return this.capture !== null && this.capture.recorder.state !== "inactive";
	}

	get elapsedMs(): number {
		return this.isRecording ? Date.now() - this.startedAt : 0;
	}

	async start(): Promise<void> {
		if (this.capture) {
			throw new AudioError("Recording already running", "Stop the current recording first.");
		}

		const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
		const result = await bunRpc.startRecordingFile({ suggestedName: `weclank-${ts}.mp4` });
		if (!result.success) {
			if (result.reason === "canceled") return;
			throw new IpcError(
				result.error ?? "unknown",
				`Couldn't start recording: ${result.error ?? "no detail"}`,
			);
		}

		this.writeChain = Promise.resolve();
		this.startedAt = Date.now();
		this.capture = startBroadcastCapture({
			source: streamEngine,
			quality: studio.state.stream.quality,
			chunkIntervalMs: 5_000,
			onChunk: (blob) => {
				this.writeChain = this.writeChain.then(() => this.shipChunk(blob));
			},
			onError: (event) => {
				console.error("[recorder] error", event);
				toast("Recording error — see console", "error");
			},
		});
		studio.setStream({ recording: true });
	}

	async stop(): Promise<{ path?: string; canceled?: boolean }> {
		const capture = this.capture;
		this.capture = null;
		studio.setStream({ recording: false });
		if (!capture) {
			return { canceled: true };
		}

		await capture.stop();
		await this.flushChunks();

		const result = await bunRpc.finishRecordingFile({});
		if (result.success && result.path) return { path: result.path };
		if (result.reason === "canceled") return { canceled: true };
		throw new IpcError(
			result.error ?? "unknown",
			`Couldn't finalize recording: ${result.error ?? "no detail"}`,
		);
	}

	private async shipChunk(blob: Blob): Promise<void> {
		const buffer = await blob.arrayBuffer();
		const base64 = arrayBufferToBase64(buffer);
		const result = await bunRpc.writeRecordingChunk({ base64 });
		if (!result.ok) {
			console.warn("[recorder] chunk rejected", result.error);
		}
	}

	private async flushChunks(): Promise<void> {
		await this.writeChain;
	}
}

export const localRecorder = new LocalRecorder();
