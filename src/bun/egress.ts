// FFmpeg argument builder + progress parser for RTMP egress.
//
// Two parsers live here:
//   - parseFfmpegProgressKv(): the modern path. ffmpeg's `-progress pipe:1`
//     emits stable key=value lines (frame, fps, bitrate, total_size,
//     out_time_us, drop_frames, speed, progress=continue/end). Used by
//     the egress process for live HUD stats.
//   - parseFfmpegProgressLine(): legacy stderr regex scrape — retained
//     for backward-compat tests and as a fallback. New code should not
//     call this.
//
// The arg builder takes { encoder, targets, fps, bitrate }. The fps and
// bitrate are threaded from the renderer's active preset; without them
// ffmpeg falls back to encoder defaults (~2 Mbps regardless of resolution)
// which is the literal smoking-gun bug the audit caught.

export interface EgressStats {
	fps?: number;
	bitrateKbps?: number;
	droppedFrames?: number;
	timeSeconds?: number;
	speed?: number;
	updatedAt?: number;
}

export interface EncoderProfile {
	name: string;
	extraArgs: string[];
	label: string;
}

export interface BuildFfmpegArgsInput {
	encoder: EncoderProfile;
	targets: string[];
	/** Source framerate (24 / 30 / 60). Drives `-g` and `-keyint_min`
	 *  so keyframes land exactly 2s apart at any preset. */
	fps: number;
	/** Video bitrate in bits-per-second from the active preset. Drives
	 *  `-b:v`, `-maxrate`, and `-bufsize`. Required — passing 0 or
	 *  omitting it means ffmpeg picks its own (wrong) default. */
	videoBitsPerSecond: number;
	/** Audio bitrate in bits-per-second. Defaults to 128k if absent. */
	audioBitsPerSecond?: number;
}

/** Legacy stderr-regex parser. Kept for the unit test and as a fallback
 *  if `-progress pipe:1` is unavailable. Prefer `parseFfmpegProgressKv`. */
export function parseFfmpegProgressLine(prev: EgressStats, line: string, now = Date.now()): EgressStats {
	const next: EgressStats = { ...prev };
	let touched = false;
	const fps = line.match(/\bfps=\s*(\d+(?:\.\d+)?)/);
	if (fps) { next.fps = Number(fps[1]); touched = true; }
	const bitrate = line.match(/\bbitrate=\s*([\d.]+)\s*kbits\/s/);
	if (bitrate) { next.bitrateKbps = Number(bitrate[1]); touched = true; }
	const drop = line.match(/\bdrop=\s*(\d+)/);
	if (drop) { next.droppedFrames = Number(drop[1]); touched = true; }
	const time = line.match(/\btime=(\d+):(\d+):([\d.]+)/);
	if (time) {
		next.timeSeconds = Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3]);
		touched = true;
	}
	const speed = line.match(/\bspeed=\s*([\d.]+)x/);
	if (speed) { next.speed = Number(speed[1]); touched = true; }
	return touched ? { ...next, updatedAt: now } : prev;
}

/** Modern parser for `-progress pipe:1 -nostats` output. The block
 *  ends with a `progress=continue` (still encoding) or `progress=end`
 *  (final flush). We flush stats only when we see a terminator so
 *  partial bursts don't show inconsistent numbers. */
export function parseFfmpegProgressKv(prev: EgressStats, lines: string[], now = Date.now()): EgressStats {
	let next: EgressStats = { ...prev };
	let terminated = false;
	let touched = false;
	for (const raw of lines) {
		const line = raw.trim();
		if (!line) continue;
		const eq = line.indexOf("=");
		if (eq <= 0) continue;
		const key = line.slice(0, eq);
		const value = line.slice(eq + 1);
		switch (key) {
			case "fps": {
				const v = Number(value);
				if (Number.isFinite(v)) { next.fps = v; touched = true; }
				break;
			}
			case "bitrate": {
				// "1234.5kbits/s" or "N/A"
				const m = value.match(/^([\d.]+)\s*kbits\/s$/i);
				if (m) { next.bitrateKbps = Number(m[1]); touched = true; }
				break;
			}
			case "drop_frames": {
				const v = Number(value);
				if (Number.isFinite(v)) { next.droppedFrames = v; touched = true; }
				break;
			}
			case "out_time_us": {
				const v = Number(value);
				if (Number.isFinite(v)) { next.timeSeconds = v / 1_000_000; touched = true; }
				break;
			}
			case "out_time": {
				// Fallback if out_time_us missing — "00:00:08.500000"
				if (next.timeSeconds === undefined) {
					const m = value.match(/^(\d+):(\d+):([\d.]+)/);
					if (m) {
						next.timeSeconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
						touched = true;
					}
				}
				break;
			}
			case "speed": {
				// "1.25x" or "N/A"
				const m = value.match(/^([\d.]+)x?$/);
				if (m) { next.speed = Number(m[1]); touched = true; }
				break;
			}
			case "progress": {
				terminated = true;
				break;
			}
		}
	}
	if (touched && terminated) next = { ...next, updatedAt: now };
	return touched ? next : prev;
}

export function buildRtmpUrl(rtmpUrl: string, streamKey: string): string {
	const base = rtmpUrl.replace(/\/$/, "");
	if (!streamKey) return base;
	if (base.includes("?") || base.split("/").length > 4) return `${base}/${streamKey}`;
	return `${base}/${streamKey}`;
}

/** GOP and keyint pinned to 2 seconds at the source framerate, with
 *  scenecut disabled so encoders insert IDRs on exact 2s boundaries
 *  (which is what RTMP receivers + HLS segmenters expect). */
function gopArgs(fps: number): string[] {
	const g = Math.max(1, Math.round(fps * 2));
	return [
		"-g", String(g),
		"-keyint_min", String(g),
		"-sc_threshold", "0",
		"-force_key_frames", `expr:gte(t,n_forced*2)`,
	];
}

/** Per-FLV-output flags + the canonical bitstream filter to suppress
 *  the bogus end-of-stream duration/filesize write that RTMP sinks
 *  sometimes reject. */
const FLV_OPTS = "f=flv:flvflags=+no_duration_filesize:onfail=ignore";

export function buildFfmpegArgs(input: BuildFfmpegArgsInput): string[] {
	const { encoder, targets, fps, videoBitsPerSecond } = input;
	const audioBitrate = input.audioBitsPerSecond ?? 128_000;
	const bufsize = videoBitsPerSecond * 2;

	const outputArgs = targets.length === 1
		? [
				"-flvflags", "+no_duration_filesize",
				"-f", "flv",
				targets[0]!,
			]
		: [
				"-flags", "+global_header",
				"-f", "tee",
				"-use_fifo", "1",
				"-map", "0:v",
				"-map", "0:a",
				targets.map((target) => `[${FLV_OPTS}]${target}`).join("|"),
			];

	return [
		"ffmpeg",
		"-hide_banner",
		"-loglevel", "warning",
		// --- Input: WebM-on-stdin, low-latency tuning ----------------
		// The FFmpeg audit's P2 #7 recommended an aggressive low-latency
		// set; smoke-testing against real MediaRecorder output revealed
		// two breakers and one stayer:
		//   - `-probesize 32 -analyzeduration 0 -avioflags direct`:
		//     no — 32 bytes is too little to find the VP8 keyframe; the
		//     decoder discards interframes and ffmpeg exits 69.
		//   - `-fflags +nobuffer`: no — same root cause; nobuffer skips
		//     input-stream analysis which is exactly where the keyframe
		//     is located.
		//   - `-fflags +genpts`: yes — WebKit's MediaRecorder occasionally
		//     emits clusters with missing PTS on the trailing partial
		//     fragment; regen is belt-and-suspenders harmless.
		//   - `-flags +low_delay`: yes — skip frame reordering. Safe.
		//   - `-thread_queue_size 512`: yes — deeper pipe-input buffer.
		"-fflags", "+genpts",
		"-flags", "+low_delay",
		"-thread_queue_size", "512",
		"-f", "webm",
		"-i", "pipe:0",
		// --- Video encode ------------------------------------------
		"-c:v", encoder.name,
		...encoder.extraArgs,
		"-pix_fmt", "yuv420p",
		"-b:v", String(videoBitsPerSecond),
		"-maxrate", String(videoBitsPerSecond),
		"-bufsize", String(bufsize),
		...gopArgs(fps),
		// --- Audio encode ------------------------------------------
		"-c:a", "aac",
		"-b:a", `${Math.round(audioBitrate / 1000)}k`,
		"-ar", "48000",
		// --- Progress reporting ------------------------------------
		// `-progress pipe:1 -nostats` emits stable key=value blocks
		// terminated by `progress=continue|end`. The Bun-side reader
		// parses these instead of scraping the stderr human display.
		"-progress", "pipe:1",
		"-nostats",
		// --- Output(s) ---------------------------------------------
		...outputArgs,
	];
}
