// ffmpeg stderr line classifier.
//
// Two arrays drive `classify(line)`:
//   - IGNORED_PATTERNS: substrings that mean "this is harmless noise"
//     (deprecated-pixel-format warnings, last-message-repeated, etc.)
//   - ERROR_MAP: substring patterns paired with a friendly user-facing
//     message. When a line matches we surface the friendly message via
//     StudioError.userMessage; the original technical line goes to logs.
//
// Patterns are ported from owncast core/transcoder/utils.go:21-99,
// adapted to weclank's RTMP egress context (some HLS-specific messages
// dropped; RTMP-specific messages added).
//
// "facts not code" — these strings describe ffmpeg's actual stderr
// output, not owncast's implementation. They're freely reproducible.

export interface ClassifyResult {
	/** True if this line is harmless noise and should be suppressed. */
	ignore?: true;
	/** A friendly user-facing message if the line matches a known
	 *  failure mode. Absent for unrecognized errors (caller may still
	 *  want to log the raw line). */
	userMessage?: string;
	/** Severity hint for the UI. `fatal` = stop the stream; `transient`
	 *  = log and continue; `info` = surface in HUD but not as toast. */
	severity?: "fatal" | "transient" | "info";
}

const IGNORED_PATTERNS: readonly string[] = [
	"Duplicated segment filename detected",
	"Last message repeated",
	"Non-monotonous DTS in output",
	"frames duplicated",
	"To ignore this",
	"VBV underflow",
	"Cannot use rename on non file protocol",
	"Past duration",
	"deprecated pixel format used",
	"Driver does not support some wanted packed headers",
	"maybe the hls segment duration will not precise",
	"use of closed network connection",
	"URL read error: End of file",
	"upload playlist failed, will retry with a new http session",
];

// Friendly translations for known stderr substrings. Order doesn't
// matter; first match wins.
const ERROR_MAP: ReadonlyArray<{
	pattern: string;
	userMessage: string;
	severity: "fatal" | "transient" | "info";
}> = [
	// ---- Encoder availability / drivers --------------------------------
	{
		pattern: "Unknown encoder 'h264_nvenc'",
		userMessage:
			"This ffmpeg build lacks NVIDIA NVENC support. Install the NVIDIA driver + CUDA runtime, or switch to libx264 in encoder settings.",
		severity: "fatal",
	},
	{
		pattern: "Unknown encoder 'h264_qsv'",
		userMessage:
			"This ffmpeg build lacks Intel QuickSync support. Switch to libx264 in encoder settings.",
		severity: "fatal",
	},
	{
		pattern: "Unknown encoder 'h264_vaapi'",
		userMessage:
			"This ffmpeg build lacks VAAPI support. Switch to libx264 in encoder settings.",
		severity: "fatal",
	},
	{
		pattern: "Unknown encoder 'h264_amf'",
		userMessage:
			"This ffmpeg build lacks AMD AMF support. Switch to libx264 in encoder settings.",
		severity: "fatal",
	},
	{
		pattern: "Unknown encoder 'h264_videotoolbox'",
		userMessage:
			"This ffmpeg build lacks VideoToolbox support. Install ffmpeg from Homebrew on macOS (`brew install ffmpeg`).",
		severity: "fatal",
	},
	// ---- NVENC runtime -------------------------------------------------
	{
		pattern: "OpenEncodeSessionEx failed: out of memory",
		userMessage:
			"Your NVIDIA GPU is at its concurrent-stream limit. Stop another running encode, or use libx264.",
		severity: "fatal",
	},
	{
		pattern: "OpenEncodeSessionEx failed",
		userMessage:
			"NVENC couldn't open an encode session. NVIDIA driver may be too old; update GeForce / Studio driver to the latest.",
		severity: "fatal",
	},
	{
		pattern: "Cannot load nvcuda.dll",
		userMessage:
			"NVENC requires the NVIDIA driver runtime (nvcuda.dll). Install it or fall back to libx264.",
		severity: "fatal",
	},
	// ---- VAAPI / Intel drivers -----------------------------------------
	{
		pattern: "No VA display found for device",
		userMessage:
			"VAAPI isn't enabled on this system. Install the VAAPI driver for your GPU, or use libx264.",
		severity: "fatal",
	},
	{
		pattern: "Failed to set value '/dev/dri/renderD128' for option 'vaapi_device'",
		userMessage:
			"VAAPI device /dev/dri/renderD128 isn't accessible. Add your user to the `render` group: `sudo usermod -aG render $USER`.",
		severity: "fatal",
	},
	{
		pattern: "Unrecognized option 'vaapi_device'",
		userMessage:
			"VAAPI isn't supported by this ffmpeg build. Switch to libx264 in encoder settings.",
		severity: "fatal",
	},
	{
		pattern:
			"intel_enc_hw_context_init: Assertion 'encoder_context->mfc_context' failed",
		userMessage:
			"On Intel graphics, the i965-va-driver-shader package is missing. Install it (Debian/Ubuntu: `sudo apt install i965-va-driver-shaders`) or switch to libx264.",
		severity: "fatal",
	},
	// ---- RTMP / network ------------------------------------------------
	{
		pattern: "Connection refused",
		userMessage:
			"Streaming server refused the connection. Check the RTMP URL and that the server is reachable.",
		severity: "fatal",
	},
	{
		pattern: "Connection reset by peer",
		userMessage:
			"Streaming server dropped the connection. Network hiccup or invalid stream key — reconnect attempt will retry.",
		severity: "transient",
	},
	{
		pattern: "Broken pipe",
		userMessage:
			"Lost the connection to the streaming server. Reconnect attempt will retry.",
		severity: "transient",
	},
	{
		pattern: "RTMP_Connect0",
		userMessage:
			"Couldn't reach the streaming server. Check your network and the RTMP URL.",
		severity: "fatal",
	},
	{
		pattern: "401 Unauthorized",
		userMessage:
			"Streaming server rejected the credentials. Check your stream key.",
		severity: "fatal",
	},
	{
		pattern: "403 Forbidden",
		userMessage:
			"Streaming server rejected the stream. Stream key may be invalid, expired, or you're banned.",
		severity: "fatal",
	},
	// ---- Generic encoder / config --------------------------------------
	{
		pattern: "can't configure encoder",
		userMessage:
			"Encoder couldn't be configured. Your ffmpeg build or hardware may not support this codec — try libx264 in encoder settings.",
		severity: "fatal",
	},
	{
		pattern: "Could not find a valid device",
		userMessage:
			"Selected hardware encoder isn't available. Try a different encoder in settings or use libx264.",
		severity: "fatal",
	},
	{
		pattern: "H.264 bitstream error",
		userMessage:
			"Encoder produced a malformed H.264 stream. Try libx264 in encoder settings.",
		severity: "transient",
	},
	{
		pattern: "Stream map 'v:0' matches no streams",
		userMessage:
			"No video in the capture stream. Add a camera, screen, or AI source before going live.",
		severity: "fatal",
	},
	// ---- Generic catchall (keep last in its bucket) --------------------
	{
		pattern: "Unrecognized option",
		userMessage:
			"ffmpeg rejected one of the encoder options. Your ffmpeg may be too old — try `brew upgrade ffmpeg` (macOS) or your distro's equivalent.",
		severity: "fatal",
	},
];

/** Returns a classification for a single ffmpeg stderr line. The two
 *  outputs are independent: a line can be both `ignore` (don't surface
 *  to user) and lack a `userMessage`, or have a `userMessage` without
 *  being ignored. */
export function classifyFfmpegLine(line: string): ClassifyResult {
	const trimmed = line.trim();
	if (!trimmed) return { ignore: true };

	for (const pattern of IGNORED_PATTERNS) {
		if (trimmed.includes(pattern)) return { ignore: true };
	}

	for (const entry of ERROR_MAP) {
		if (trimmed.includes(entry.pattern)) {
			return { userMessage: entry.userMessage, severity: entry.severity };
		}
	}

	return {};
}

/** Stateful wrapper that dedupes "same user-facing message N times in
 *  a row" — useful for ffmpeg's CR-overwritten progress lines. */
export class FfmpegStderrClassifier {
	private lastUserMessage = "";

	classify(line: string): ClassifyResult {
		const result = classifyFfmpegLine(line);
		if (result.userMessage && result.userMessage === this.lastUserMessage) {
			// Same message we surfaced last time — suppress to avoid
			// toast spam during a sustained failure.
			return { ignore: true };
		}
		if (result.userMessage) this.lastUserMessage = result.userMessage;
		return result;
	}

	reset(): void {
		this.lastUserMessage = "";
	}
}
