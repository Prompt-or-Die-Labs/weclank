import { augmentedProcessEnv } from "./ffmpeg-env";

export type ShortExportPresetId = "tiktok" | "reels" | "shorts";

export interface ShortExportPreset {
	id: ShortExportPresetId;
	label: string;
	width: number;
	height: number;
	videoBitrate: string;
	audioBitrate: string;
}

export const SHORT_EXPORT_PRESETS: Record<ShortExportPresetId, ShortExportPreset> = {
	tiktok: { id: "tiktok", label: "TikTok", width: 1080, height: 1920, videoBitrate: "10M", audioBitrate: "192k" },
	reels: { id: "reels", label: "Reels", width: 1080, height: 1920, videoBitrate: "12M", audioBitrate: "192k" },
	shorts: { id: "shorts", label: "Shorts", width: 1080, height: 1920, videoBitrate: "10M", audioBitrate: "192k" },
};

export function getShortExportPreset(id: string): ShortExportPreset | null {
	return id === "tiktok" || id === "reels" || id === "shorts" ? SHORT_EXPORT_PRESETS[id] : null;
}

export function buildShortExportArgs(args: {
	inputPath: string;
	outputPath: string;
	presetId: ShortExportPresetId;
	startSec: number;
	durationSec: number;
}): string[] {
	const preset = SHORT_EXPORT_PRESETS[args.presetId];
	const start = Math.max(0, args.startSec);
	const duration = Math.max(0.05, args.durationSec);
	const scaleFilter = [
		`scale=${preset.width}:${preset.height}:force_original_aspect_ratio=decrease:flags=lanczos`,
		`pad=${preset.width}:${preset.height}:(ow-iw)/2:(oh-ih)/2`,
		"setsar=1",
	].join(",");
	return [
		"ffmpeg",
		"-y",
		"-hide_banner",
		"-loglevel",
		"error",
		"-ss",
		String(start),
		"-i",
		args.inputPath,
		"-t",
		String(duration),
		"-vf",
		scaleFilter,
		"-c:v",
		"libx264",
		"-preset",
		"fast",
		"-crf",
		"20",
		"-maxrate",
		preset.videoBitrate,
		"-bufsize",
		doubleBitrate(preset.videoBitrate),
		"-pix_fmt",
		"yuv420p",
		"-profile:v",
		"high",
		"-c:a",
		"aac",
		"-b:a",
		preset.audioBitrate,
		"-ar",
		"48000",
		"-movflags",
		"+faststart",
		args.outputPath,
	];
}

export async function exportShortMp4Segment(args: {
	inputPath: string;
	outputPath: string;
	presetId: ShortExportPresetId;
	startSec: number;
	durationSec: number;
}): Promise<void> {
	const proc = Bun.spawn(buildShortExportArgs(args), {
		stdin: "ignore",
		stdout: "ignore",
		stderr: "pipe",
		env: augmentedProcessEnv(),
	});
	const stderr = await new Response(proc.stderr).text();
	const code = await proc.exited;
	if (code !== 0) {
		throw new Error(stderr.trim() || `ffmpeg short export exited with code ${code}`);
	}
}

function doubleBitrate(value: string): string {
	const normalized = value.trim().toLowerCase();
	if (normalized.endsWith("m")) return `${Math.round(Number(normalized.slice(0, -1)) * 2)}M`;
	if (normalized.endsWith("k")) return `${Math.round(Number(normalized.slice(0, -1)) * 2)}k`;
	return value;
}
