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

const RECORDER_STOP_TIMEOUT_MS = 45_000;

interface RecorderSession {
	capture: BroadcastCaptureSession;
	writeChain: Promise<void>;
	chunkError: Error | null;
	acceptingChunks: boolean;
}

function promiseWithTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise((resolve, reject) => {
		const id = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
		p.then(
			(value) => {
				clearTimeout(id);
				resolve(value);
			},
			(error) => {
				clearTimeout(id);
				reject(error);
			},
		);
	});
}

class LocalRecorder {
	private session: RecorderSession | null = null;
	private finalizing = false;
	private starting = false;
	private startedAt = 0;

	get isRecording(): boolean {
		return this.session !== null;
	}

	get elapsedMs(): number {
		return this.isRecording ? Date.now() - this.startedAt : 0;
	}

	async start(): Promise<void> {
		if (this.session || this.starting) {
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

			let session: RecorderSession | null = null;
			this.startedAt = Date.now();
			const capture = startBroadcastCapture({
				source: streamEngine,
				quality: studio.state.stream.quality,
				chunkIntervalMs: 5_000,
				onChunk: (blob) => {
					if (!session?.acceptingChunks) return;
					const activeSession = session;
					activeSession.writeChain = activeSession.writeChain
						.then(() => this.shipChunk(blob))
						.catch((err) => {
							activeSession.chunkError = err instanceof Error ? err : new Error(String(err));
						});
				},
				onError: (event) => {
					console.error("[recorder] error", event);
					toast("Recording error — see console", "error");
				},
			});
			session = { capture, writeChain: Promise.resolve(), chunkError: null, acceptingChunks: true };
			this.session = session;
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
		const session = this.session;
		this.session = null;
		studio.setStream({ recording: false });
		if (!session) return;

		this.finalizing = true;
		void this.finalize(session)
			.finally(() => {
				this.finalizing = false;
			})
			.catch((err) => {
				console.error("[recorder] finalize cleanup failed", err);
				toast(`Save failed: ${userMessageFor(err)}`, "error");
			});
	}

	private async finalize(session: RecorderSession): Promise<void> {
		let savedPath: string | null = null;
		try {
			await promiseWithTimeout(session.capture.stop(), RECORDER_STOP_TIMEOUT_MS, "MediaRecorder stop");
			session.acceptingChunks = false;
			await session.writeChain;
			if (session.chunkError) throw session.chunkError;
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
			session.acceptingChunks = false;
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
			throw new IpcError(result.error ?? "unknown", `Couldn't write recording chunk: ${result.error ?? "no detail"}`);
		}
	}
}

export const localRecorder = new LocalRecorder();
