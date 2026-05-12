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

const RECORDER_STOP_TIMEOUT_MS = 45_000;

function promiseWithTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise((resolve, reject) => {
		const id = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
		p.then(
			(v) => {
				clearTimeout(id);
				resolve(v);
			},
			(e) => {
				clearTimeout(id);
				reject(e);
			},
		);
	});
}

class LocalRecorder {
	private capture: BroadcastCaptureSession | null = null;
	/** Coalesces concurrent `stop()` calls so only one `finishRecordingFile` runs. */
	private stopInFlight: Promise<{ path?: string; canceled?: boolean }> | null = null;
	/** True while the save dialog or Bun file open is in flight — prevents a
	 * second start from hitting "recording already in progress" on the main
	 * process before `this.capture` is assigned. */
	private starting = false;
	private startedAt = 0;
	/** Serializes chunk writes so the last `dataavailable` blob finishes
	 * before `finishRecordingFile` closes the handle (MediaRecorder does
	 * not await `onChunk`). */
	private writeChain: Promise<void> = Promise.resolve();

	get isRecording(): boolean {
		// Must stay true until `stop()` clears `this.capture` in `finally`. If we
		// keyed off MediaRecorder.state === "inactive", the instant `stop()` is
		// called we'd flip false while flush/ffmpeg still run — the next "REC"
		// click would try `start()` and hit "already recording".
		return this.capture !== null;
	}

	get elapsedMs(): number {
		return this.isRecording ? Date.now() - this.startedAt : 0;
	}

	async start(): Promise<void> {
		if (this.capture) {
			throw new AudioError("Recording already running", "Stop the current recording first.");
		}
		if (this.starting) {
			throw new AudioError(
				"Recording start already in progress",
				"Wait for the save dialog to finish, or try again in a moment.",
			);
		}

		this.starting = true;
		let diskSessionOpen = false;
		try {
			const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
			const suggestedName = `weclank-${ts}.mp4`;
			let result = await bunRpc.startRecordingFile({ suggestedName });
			if (!result.success && result.error === "Recording already in progress") {
				// Orphaned main-process session (e.g. prior stop hung before finish) — clear and retry once.
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

	async stop(): Promise<{ path?: string; canceled?: boolean }> {
		if (this.stopInFlight) return this.stopInFlight;
		if (!this.capture) {
			studio.setStream({ recording: false });
			return { canceled: true };
		}

		this.stopInFlight = this.stopAndFinalize().finally(() => {
			this.stopInFlight = null;
		});
		return this.stopInFlight;
	}

	private async stopAndFinalize(): Promise<{ path?: string; canceled?: boolean }> {
		const capture = this.capture;
		if (!capture) {
			studio.setStream({ recording: false });
			return { canceled: true };
		}

		let bunSessionFinished = false;

		try {
			await promiseWithTimeout(capture.stop(), RECORDER_STOP_TIMEOUT_MS, "MediaRecorder stop");
			await this.flushChunks();

			const result = await bunRpc.finishRecordingFile({});
			if (result.success && result.path) {
				bunSessionFinished = true;
				const savedPath = result.path;
				void import("../components/recording-review-dialog").then(({ openRecordingReviewDialog }) => {
					openRecordingReviewDialog(savedPath);
				});
				return { path: savedPath };
			}
			if (result.reason === "canceled") {
				bunSessionFinished = true;
				return { canceled: true };
			}
			throw new IpcError(
				result.error ?? "unknown",
				`Couldn't finalize recording: ${result.error ?? "no detail"}`,
			);
		} finally {
			this.capture = null;
			studio.setStream({ recording: false });
			if (!bunSessionFinished) {
				await bunRpc.cancelRecordingFile({}).catch(() => {});
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

	private async flushChunks(): Promise<void> {
		await this.writeChain;
	}
}

export const localRecorder = new LocalRecorder();
