// Local recorder — captures the broadcast stream to a WebM file via the
// same MediaRecorder pipeline that feeds the RTMP egress, but instead of
// shipping chunks to ffmpeg's stdin we accumulate the Blob and save it
// once stopped (or periodically, for crash-survival).
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
	private busy = false;
	private startedAt = 0;

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
		const result = await bunRpc.startRecordingFile({ suggestedName: `weclank-${ts}.webm` });
		if (!result.success) {
			if (result.reason === "canceled") return;
			throw new IpcError(
				result.error ?? "unknown",
				`Couldn't start recording: ${result.error ?? "no detail"}`,
			);
		}

		this.startedAt = Date.now();
		this.capture = startBroadcastCapture({
			source: streamEngine,
			quality: studio.state.stream.quality,
			chunkIntervalMs: 5_000,
			onChunk: (blob) => { void this.shipChunk(blob); },
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
		while (this.busy) await new Promise((r) => setTimeout(r, 5));
		this.busy = true;
		try {
			const buffer = await blob.arrayBuffer();
			const base64 = arrayBufferToBase64(buffer);
			const result = await bunRpc.writeRecordingChunk({ base64 });
			if (!result.ok) {
				console.warn("[recorder] chunk rejected", result.error);
			}
		} finally {
			this.busy = false;
		}
	}

	private async flushChunks(): Promise<void> {
		while (this.busy) await new Promise((r) => setTimeout(r, 5));
	}
}

export const localRecorder = new LocalRecorder();
