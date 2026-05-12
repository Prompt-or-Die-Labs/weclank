// Bun inherits the parent process PATH. Electrobun / Cursor / Dock launches
// often get a minimal PATH without Homebrew — prepend usual bin dirs so
// `ffmpeg` resolves the same as in an interactive shell.

const PREFIX_DARWIN = ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"];
const PREFIX_LINUX = ["/home/linuxbrew/.linuxbrew/bin", "/usr/local/bin", "/opt/homebrew/bin"];
const PREFIX_WIN32 = [String.raw`C:\ProgramData\chocolatey\bin`];

/** Build PATH with standard third-party bin dirs prepended (first match wins). */
export function buildPathForFfmpeg(platform: NodeJS.Platform, existing: string): string {
	const sep = platform === "win32" ? ";" : ":";
	const prefixes =
		platform === "darwin" ? PREFIX_DARWIN : platform === "linux" ? PREFIX_LINUX : platform === "win32" ? PREFIX_WIN32 : [];
	const block = prefixes.join(sep);
	if (!block) return existing;
	if (!existing.trim()) return block;
	return `${block}${sep}${existing}`;
}

export function pathForFfmpegSpawn(): string {
	return buildPathForFfmpeg(process.platform, process.env["PATH"] ?? "");
}

/** Full `process.env` with PATH adjusted so `ffmpeg` is discoverable from GUI launches. */
export function augmentedProcessEnv(): Record<string, string | undefined> {
	return { ...process.env, PATH: pathForFfmpegSpawn() };
}
