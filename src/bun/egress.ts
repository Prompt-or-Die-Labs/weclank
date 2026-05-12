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

export function buildRtmpUrl(rtmpUrl: string, streamKey: string): string {
	const base = rtmpUrl.replace(/\/$/, "");
	if (!streamKey) return base;
	if (base.includes("?") || base.split("/").length > 4) return `${base}/${streamKey}`;
	return `${base}/${streamKey}`;
}

export function buildFfmpegArgs(encoder: EncoderProfile, targets: string[]): string[] {
	const outputArgs = targets.length === 1
		? ["-f", "flv", targets[0]!]
		: [
				"-f",
				"tee",
				"-map",
				"0:v",
				"-map",
				"0:a",
				targets.map((target) => `[f=flv]${target}`).join("|"),
			];
	return [
		"ffmpeg",
		"-hide_banner",
		"-loglevel",
		"warning",
		"-f",
		"webm",
		"-i",
		"pipe:0",
		"-c:v",
		encoder.name,
		...encoder.extraArgs,
		"-pix_fmt",
		"yuv420p",
		"-g",
		"60",
		"-c:a",
		"aac",
		"-b:a",
		"128k",
		"-ar",
		"48000",
		...outputArgs,
	];
}
