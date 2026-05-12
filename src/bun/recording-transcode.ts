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
