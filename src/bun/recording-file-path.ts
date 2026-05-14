import { stat } from "node:fs/promises";
import { join, parse } from "node:path";

export async function uniqueRecordingOutputPath(folderPath: string, fileName: string): Promise<string> {
	const parsed = parse(fileName);
	const stem = parsed.name || "weclank-recording";
	const ext = parsed.ext || ".mp4";
	for (let i = 0; i < 1000; i++) {
		const suffix = i === 0 ? "" : `-${i + 1}`;
		const candidate = join(folderPath, `${stem}${suffix}${ext}`);
		if (!(await pathExists(candidate))) return candidate;
	}
	throw new Error("Could not choose an unused recording filename");
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (error) {
		const code = error instanceof Error && "code" in error ? (error as Error & { code?: string }).code : "";
		if (code === "ENOENT") return false;
		throw error;
	}
}
