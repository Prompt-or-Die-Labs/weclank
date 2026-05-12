// Stream quality presets — single source of truth for resolution, fps,
// bitrate. Compose tier + audio tier so the user (or auto-selection logic
// later) can dial in the right tradeoff between visual quality and
// machine load.
//
// "low" is the recommended default for the developer-streaming use case:
// 720p at 24fps with VP8 and a hardware encoder downstream burns roughly
// one-eighth the CPU of the 1080p/VP9/libx264 path while looking identical
// at the viewer's typical display size.

import { AudioError } from "../core/errors";
import type { StreamQuality } from "../core/types";

export interface StreamPreset {
	width: number;
	height: number;
	fps: number;
	videoBitsPerSecond: number;
	audioBitsPerSecond: number;
	/** MediaRecorder MIME — VP8 encodes much faster than VP9 with marginal
	 * quality cost, especially when ffmpeg downstream is going to transcode
	 * to H.264 anyway. */
	mimeType: string;
}

export const PRESETS: Record<StreamQuality, StreamPreset> = {
	"480p": {
		width: 854,
		height: 480,
		fps: 24,
		videoBitsPerSecond: 1_200_000,
		audioBitsPerSecond: 96_000,
		mimeType: "video/webm; codecs=vp8,opus",
	},
	"720p": {
		width: 1280,
		height: 720,
		fps: 30,
		videoBitsPerSecond: 2_500_000,
		audioBitsPerSecond: 128_000,
		mimeType: "video/webm; codecs=vp8,opus",
	},
	"1080p": {
		width: 1920,
		height: 1080,
		fps: 30,
		videoBitsPerSecond: 4_500_000,
		audioBitsPerSecond: 128_000,
		mimeType: "video/webm; codecs=vp9,opus",
	},
};

/** Falls back to VP8 if the preferred MIME isn't supported by the runtime. */
export function pickSupportedMime(preferred: string): string {
	if (MediaRecorder.isTypeSupported(preferred)) return preferred;
	const fallbacks = ["video/webm; codecs=vp8,opus", "video/webm"];
	for (const f of fallbacks) {
		if (MediaRecorder.isTypeSupported(f)) return f;
	}
	throw new AudioError(
		"No supported WebM MIME type for MediaRecorder",
		"This webview can't record video for streaming. Try the CEF build or upgrade your OS.",
	);
}
