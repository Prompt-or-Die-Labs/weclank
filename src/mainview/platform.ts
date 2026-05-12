// Renderer-side OS hints for install copy (user agent — good enough for
// Electrobun webviews; no Node `process` here).

export type InstallPlatform = "darwin" | "win32" | "linux" | "unknown";

const FFMPEG_SNIPPETS: Record<Exclude<InstallPlatform, "unknown">, { label: string; copy: string }> = {
	darwin: { label: "macOS (Homebrew)", copy: "brew install ffmpeg" },
	win32: { label: "Windows (winget)", copy: "winget install --id=Gyan.FFmpeg -e" },
	linux: { label: "Debian / Ubuntu (apt)", copy: "sudo apt update && sudo apt install -y ffmpeg" },
};

export function detectInstallPlatform(): InstallPlatform {
	const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
	if (/Windows/i.test(ua)) return "win32";
	if (/Macintosh|Mac OS X/i.test(ua)) return "darwin";
	if (/Linux/i.test(ua)) return "linux";
	return "unknown";
}

/** One-line install command + short label for UI (current OS). */
export function ffmpegInstallHint(): { label: string; copy: string; docUrl: string } {
	const docUrl = "https://ffmpeg.org/download.html";
	const p = detectInstallPlatform();
	if (p === "unknown") {
		return {
			label: "ffmpeg",
			copy: "Install ffmpeg for your OS, then ensure it is on PATH.",
			docUrl,
		};
	}
	return { ...FFMPEG_SNIPPETS[p], docUrl };
}

/** Install lines for platforms other than this machine (for “Other platforms”). */
export function ffmpegPeerInstallSnippets(): Array<{ label: string; copy: string }> {
	const p = detectInstallPlatform();
	const order: Array<Exclude<InstallPlatform, "unknown">> = ["darwin", "win32", "linux"];
	if (p === "unknown") return order.map((k) => FFMPEG_SNIPPETS[k]);
	return order.filter((k) => k !== p).map((k) => FFMPEG_SNIPPETS[k]);
}

/** Shown after the install command — PATH is inherited from the parent environment. */
export function ffmpegAfterInstallSentence(): string {
	return "Then restart Weclank so the app picks up an updated PATH (or launch it from a shell where ffmpeg already works).";
}
