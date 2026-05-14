export function recordingDateName(date = new Date()): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `weclank-${year}-${month}-${day}`;
}

export function recordingFileName(input: string, fallbackStem = recordingDateName()): string {
	const fallback = cleanStem(fallbackStem) || "weclank-recording";
	const raw = input.trim() || fallback;
	const stem = cleanStem(raw.replace(/\.(mp4|webm)$/i, "")) || fallback;
	return `${stem}.mp4`;
}

function cleanStem(value: string): string {
	return value
		.replace(/[\/\\]+/g, " ")
		.replace(/[<>:"|?*\u0000-\u001F]/g, "-")
		.replace(/\s+/g, " ")
		.replace(/-+/g, "-")
		.trim()
		.replace(/^[.\s-]+/, "")
		.replace(/[.\s-]+$/, "")
		.slice(0, 96);
}
