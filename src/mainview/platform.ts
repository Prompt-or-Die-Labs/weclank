// Renderer-side OS hints for install copy (user agent — good enough for
// Electrobun webviews; no Node `process` here).

export type InstallPlatform = "darwin" | "win32" | "linux" | "unknown";

export function detectInstallPlatform(): InstallPlatform {
	const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
	if (/Windows/i.test(ua)) return "win32";
	if (/Macintosh|Mac OS X/i.test(ua)) return "darwin";
	if (/Linux/i.test(ua)) return "linux";
	return "unknown";
}

/** One-line install command + short label for UI. */
export function ffmpegInstallHint(): { label: string; copy: string; docUrl: string } {
	const docUrl = "https://ffmpeg.org/download.html";
	switch (detectInstallPlatform()) {
		case "darwin":
			return {
				label: "macOS (Homebrew)",
				copy: "brew install ffmpeg",
				docUrl,
			};
		case "win32":
			return {
				label: "Windows (winget)",
				copy: "winget install --id=Gyan.FFmpeg -e",
				docUrl,
			};
		case "linux":
			return {
				label: "Debian / Ubuntu (apt)",
				copy: "sudo apt update && sudo apt install -y ffmpeg",
				docUrl,
			};
		default:
			return {
				label: "ffmpeg",
				copy: "Install ffmpeg for your OS, then ensure it is on PATH.",
				docUrl,
			};
	}
}
