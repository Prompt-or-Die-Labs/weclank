// Platform-specific app-data paths. Single source of truth — everything
// else (db, secrets, ffmpeg logs, carrots) chains off userDataDir().

export function userDataDir(): string {
	const home = Bun.env["HOME"] ?? "";
	if (process.platform === "darwin") return `${home}/Library/Application Support/Weclank`;
	if (process.platform === "win32") return `${Bun.env["APPDATA"] ?? home}/Weclank`;
	return `${Bun.env["XDG_CONFIG_HOME"] ?? `${home}/.config`}/weclank`;
}

export function ffmpegLogDir(): string {
	return `${userDataDir()}/logs`;
}
