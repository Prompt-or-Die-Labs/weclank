import type { StreamQuality } from "../core/types";
import { PRESETS, pickSupportedMime } from "./presets";

export interface BroadcastStreamSource {
	setResolution(width: number, height: number): void;
	setTargetFps(fps: number): void;
	getOutputStream(fps: number): MediaStream;
}

export interface BroadcastCaptureSession {
	readonly recorder: MediaRecorder;
	readonly mimeType: string;
	stop(): Promise<void>;
}

export function startBroadcastCapture(args: {
	source: BroadcastStreamSource;
	quality: StreamQuality;
	chunkIntervalMs: number;
	onChunk(blob: Blob): void;
	onError(event: Event): void;
}): BroadcastCaptureSession {
	const preset = PRESETS[args.quality];
	const mimeType = pickSupportedMime(preset.mimeType);
	args.source.setResolution(preset.width, preset.height);
	args.source.setTargetFps(preset.fps);

	const stream = args.source.getOutputStream(preset.fps);
	const recorder = new MediaRecorder(stream, {
		mimeType,
		videoBitsPerSecond: preset.videoBitsPerSecond,
		audioBitsPerSecond: preset.audioBitsPerSecond,
	});

	recorder.ondataavailable = (event: BlobEvent): void => {
		if (event.data.size > 0) args.onChunk(event.data);
	};
	recorder.onerror = args.onError;
	recorder.start(args.chunkIntervalMs);

	return {
		recorder,
		mimeType,
		stop: () => stopRecorder(recorder),
	};
}

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
			fallback = setTimeout(finish, 500);
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
