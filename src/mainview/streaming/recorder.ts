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
import { broadcastCapture, type CaptureSink } from "./capture";
import { recordingDateName } from "../../shared/recording-names";
import type { Participant } from "../core/types";

const RECORDER_CHUNK_INTERVAL_MS = 1_000;
const RECORDER_STOP_TIMEOUT_MS = 45_000;
const RECORDER_FINISH_TIMEOUT_MS = 120_000;
const RECORDER_SINK_ID = "recorder";

interface RecorderSession {
	sinkId: string;
	writeChain: Promise<void>;
	chunkError: Error | null;
	bytesWritten: number;
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

	async start(): Promise<boolean> {
		if (this.session || this.starting) {
			throw new AudioError("Recording already running", "Stop the current recording first.");
		}
		if (this.finalizing) {
			throw new AudioError("Still saving the previous recording", "Give it a moment and try again.");
		}

		this.starting = true;
		let diskSessionOpen = false;
		try {
			if (!(await ensureRecordableSource())) return false;
			const { pickRecordingFileName } = await import("./recording-name-dialog");
			const suggestedName = await pickRecordingFileName(recordingDateName());
			if (!suggestedName) return false;
			let result = await bunRpc.startRecordingFile({ suggestedName });
			if (!result.success && result.error === "Recording already in progress") {
				// Orphaned main-process session — clear and retry once.
				await bunRpc.cancelRecordingFile({}).catch(() => {});
				result = await bunRpc.startRecordingFile({ suggestedName });
			}
			if (!result.success) {
				if (result.reason === "canceled") return false;
				throw new IpcError(
					result.error ?? "unknown",
					`Couldn't start recording: ${result.error ?? "no detail"}`,
				);
			}
			diskSessionOpen = true;

			const session: RecorderSession = {
				sinkId: RECORDER_SINK_ID,
				writeChain: Promise.resolve(),
				chunkError: null,
				bytesWritten: 0,
			};
			const sink: CaptureSink = {
				id: session.sinkId,
				onChunk: (blob) => {
					session.writeChain = session.writeChain
						.then(() => this.shipChunk(blob))
						.then((bytes) => {
							session.bytesWritten += bytes;
						})
						.catch((err) => {
							session.chunkError = err instanceof Error ? err : new Error(String(err));
						});
				},
				onStop: async () => {
					// Detach awaits this AFTER MediaRecorder has flushed its
					// final dataavailable, so all chunks are queued. Drain
					// the write chain so finalize sees the final byte count.
					await session.writeChain;
				},
			};

			this.startedAt = Date.now();
			await broadcastCapture.attach(sink, {
				source: streamEngine,
				quality: studio.state.stream.quality,
				chunkIntervalMs: RECORDER_CHUNK_INTERVAL_MS,
			});
			this.session = session;
			studio.setStream({ recording: true });
			return true;
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
		if (!session) {
			toast("No active recording to save", "info");
			return;
		}

		this.finalizing = true;
		toast("Saving recording...", "info");
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
			// Detach drains MediaRecorder AND the sink's onStop (which awaits
			// the write chain), so by the time this resolves all chunks have
			// been shipped to Bun.
			await promiseWithTimeout(
				broadcastCapture.detach(session.sinkId),
				RECORDER_STOP_TIMEOUT_MS,
				"MediaRecorder stop",
			);
			if (session.chunkError) throw session.chunkError;
			if (session.bytesWritten === 0) {
				throw new AudioError(
					"Recording produced no video data",
					"The recorder stopped before the webview delivered any encoded video. Try recording for another second.",
				);
			}
			const result = await promiseWithTimeout(
				bunRpc.finishRecordingFile({}),
				RECORDER_FINISH_TIMEOUT_MS,
				"Recording save",
			);
			if (result.success && result.path) {
				savedPath = result.path;
				toast(`Recording saved to ${savedPath}`, "success");
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
				openRecordingReviewDialog(savedPath, { saved: true });
			}
		}
	}

	private async shipChunk(blob: Blob): Promise<number> {
		const buffer = await blob.arrayBuffer();
		const base64 = arrayBufferToBase64(buffer);
		const result = await bunRpc.writeRecordingChunk({ base64 });
		if (!result.ok) {
			throw new IpcError(result.error ?? "unknown", `Couldn't write recording chunk: ${result.error ?? "no detail"}`);
		}
		return buffer.byteLength;
	}
}

export const localRecorder = new LocalRecorder();

async function ensureRecordableSource(): Promise<boolean> {
	if (hasRecordableSource()) return true;
	const [{ createParticipantFromKind }, { pickRecordingSource }] = await Promise.all([
		import("../state/source-factory"),
		import("./recording-source-dialog"),
	]);
	const id = await pickRecordingSource(async (kind) => {
		return createParticipantFromKind(kind, { startVideo: true });
	});
	if (!id) return false;
	studio.updateSourcePlacement(studio.activeScene.id, id, { x: 0, y: 0, w: 1, h: 1, visible: true });
	return hasRecordableSource();
}

function hasRecordableSource(): boolean {
	return studio.activeScene.sources.some((source) => {
		if (!source.visible) return false;
		const participant = studio.state.participants[source.participantId];
		return participant ? participantHasRecordableVideo(participant) : false;
	});
}

function participantHasRecordableVideo(participant: Participant): boolean {
	switch (participant.kind) {
		case "screen":
			return Boolean(participant.mediaStream);
		case "camera":
			return !participant.cameraOff;
		case "voice":
		case "voice-image":
		case "voice-vrm":
		case "voice-glb":
			return true;
		case "browser":
			// Browser source is local-preview-only in phase 1 (cross-origin
			// canvas tainting). Treat as not-recordable so going live
			// without other sources surfaces the real "no recordable video"
			// state instead of a silent blank tile.
			return false;
		case "mic":
		case "text":
			return false;
	}
}
