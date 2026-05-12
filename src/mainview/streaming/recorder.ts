// Local recorder — MediaRecorder encodes VP8/9 + Opus into WebM (same
// pipeline as RTMP egress). Chunks are streamed to a temp WebM in the
// system temp directory; on stop, Bun runs ffmpeg to transcode to H.264+AAC
// MP4 at the path you pick (+faststart for quick playback start).
//
// Stop is a USER INTENT: the UI flips immediately when the user clicks
// stop. The actual MediaRecorder teardown + ffmpeg finalize run in the
// background. A toast announces the result when the file is ready (or
// if something goes wrong). This is the single most important property
// of this module — never make the user wait on encoding to click again.

import { streamEngine } from "./stream-engine";
import { studio } from "../state/studio-store";
import { bunRpc } from "../rpc";
import { AudioError, IpcError, userMessageFor } from "../core/errors";
import { toast } from "../components/overlays";
import { arrayBufferToBase64 } from "./base64";
import { startBroadcastCapture, type BroadcastCaptureSession } from "./capture";

class LocalRecorder {
	private capture: BroadcastCaptureSession | null = null;
	private finalizing = false;
	private starting = false;
	private startedAt = 0;
	/** Serializes chunk writes so the last `dataavailable` blob finishes
	 * before `finishRecordingFile` closes the handle (MediaRecorder does
	 * not await `onChunk`). */
	private writeChain: Promise<void> = Promise.resolve();

	get isRecording(): boolean {
		return this.capture !== null;
	}

	get elapsedMs(): number {
		return this.isRecording ? Date.now() - this.startedAt : 0;
	}

	async start(): Promise<void> {
		if (this.capture || this.starting) {
			throw new AudioError("Recording already running", "Stop the current recording first.");
		}
		if (this.finalizing) {
			throw new AudioError("Still saving the previous recording", "Give it a moment and try again.");
		}

		this.starting = true;
		let diskSessionOpen = false;
		try {
			const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
			const suggestedName = `weclank-${ts}.mp4`;
			let result = await bunRpc.startRecordingFile({ suggestedName });
			if (!result.success && result.error === "Recording already in progress") {
				// Orphaned main-process session — clear and retry once.
				await bunRpc.cancelRecordingFile({}).catch(() => {});
				result = await bunRpc.startRecordingFile({ suggestedName });
			}
			if (!result.success) {
				if (result.reason === "canceled") return;
				throw new IpcError(
					result.error ?? "unknown",
					`Couldn't start recording: ${result.error ?? "no detail"}`,
				);
			}
			diskSessionOpen = true;

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
		} catch (err) {
			if (diskSessionOpen) {
				await bunRpc.cancelRecordingFile({}).catch(() => {});
			}
			throw err;
		} finally {
			this.starting = false;
		}
	}

	/** Stop is fire-and-forget. UI flips now; finalize runs in the background. */
	stop(): void {
		const capture = this.capture;
		this.capture = null;
		studio.setStream({ recording: false });
		if (!capture) return;

		this.finalizing = true;
		void this.finalize(capture).finally(() => {
			this.finalizing = false;
		});
	}

	private async finalize(capture: BroadcastCaptureSession): Promise<void> {
		let savedPath: string | null = null;
		try {
			await capture.stop();
			await this.writeChain;
			const result = await bunRpc.finishRecordingFile({});
			if (result.success && result.path) {
				savedPath = result.path;
				return;
			}
			if (result.reason === "canceled") {
				toast("Recording discarded", "info");
				return;
			}
			throw new IpcError(result.error ?? "unknown", `Couldn't finalize recording: ${result.error ?? "no detail"}`);
		} catch (err) {
			console.error("[recorder] finalize failed", err);
			toast(`Save failed: ${userMessageFor(err)}`, "error");
			await bunRpc.cancelRecordingFile({}).catch(() => {});
		} finally {
			if (savedPath) {
				const { openRecordingReviewDialog } = await import("../components/recording-review-dialog");
				openRecordingReviewDialog(savedPath);
			}
		}
	}

	private async shipChunk(blob: Blob): Promise<void> {
		const buffer = await blob.arrayBuffer();
		const base64 = arrayBufferToBase64(buffer);
		const result = await bunRpc.writeRecordingChunk({ base64 });
		if (!result.ok) {
			console.warn("[recorder] chunk rejected", result.error);
		}
	}
}

export const localRecorder = new LocalRecorder();
