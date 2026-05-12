// After local recording stops, transcode the staged WebM (MediaRecorder
// output) into a normal MP4 (H.264 + AAC) for editors and players.

import { augmentedProcessEnv } from "./ffmpeg-env";

export async function transcodeWebmFileToMp4(inputPath: string, outputPath: string): Promise<void> {
	const proc = Bun.spawn(
		[
			"ffmpeg",
			"-y",
			"-hide_banner",
			"-loglevel",
			"error",
			"-i",
			inputPath,
			"-c:v",
			"libx264",
			"-preset",
			"fast",
			"-crf",
			"20",
			"-pix_fmt",
			"yuv420p",
			"-c:a",
			"aac",
			"-b:a",
			"192k",
			"-ar",
			"48000",
			"-movflags",
			"+faststart",
			outputPath,
		],
		{
			stdin: "ignore",
			stdout: "ignore",
			stderr: "pipe",
			env: augmentedProcessEnv(),
		},
	);
	const stderr = await new Response(proc.stderr).text();
	const code = await proc.exited;
	if (code !== 0) {
		throw new Error(stderr.trim() || `ffmpeg exited with code ${code}`);
	}
}

/** Write `[startSec, startSec + durationSec)` to `outputPath` (MP4 in → MP4 out). */
export async function trimMp4Segment(
	inputPath: string,
	outputPath: string,
	startSec: number,
	durationSec: number,
): Promise<void> {
	const start = Math.max(0, startSec);
	const dur = Math.max(0.05, durationSec);
	const tryCopy = async (): Promise<boolean> => {
		const proc = Bun.spawn(
			[
				"ffmpeg",
				"-y",
				"-hide_banner",
				"-loglevel",
				"error",
				"-ss",
				String(start),
				"-i",
				inputPath,
				"-t",
				String(dur),
				"-c",
				"copy",
				"-avoid_negative_ts",
				"make_zero",
				outputPath,
			],
			{
				stdin: "ignore",
				stdout: "ignore",
				stderr: "pipe",
				env: augmentedProcessEnv(),
			},
		);
		const stderr = await new Response(proc.stderr).text();
		const code = await proc.exited;
		if (code === 0) return true;
		// Stream copy can fail on odd GOP boundaries — fall back below.
		console.warn("[ffmpeg] trim copy failed, re-encoding:", stderr.slice(0, 200));
		return false;
	};

	if (await tryCopy()) return;

	const proc = Bun.spawn(
		[
			"ffmpeg",
			"-y",
			"-hide_banner",
			"-loglevel",
			"error",
			"-ss",
			String(start),
			"-i",
			inputPath,
			"-t",
			String(dur),
			"-c:v",
			"libx264",
			"-preset",
			"fast",
			"-crf",
			"20",
			"-pix_fmt",
			"yuv420p",
			"-c:a",
			"aac",
			"-b:a",
			"192k",
			"-ar",
			"48000",
			"-movflags",
			"+faststart",
			outputPath,
		],
		{
			stdin: "ignore",
			stdout: "ignore",
			stderr: "pipe",
			env: augmentedProcessEnv(),
		},
	);
	const stderr = await new Response(proc.stderr).text();
	const code = await proc.exited;
	if (code !== 0) {
		throw new Error(stderr.trim() || `ffmpeg trim exited with code ${code}`);
	}
}
