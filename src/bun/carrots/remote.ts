// Remote carrot install: fetch a zip / tar.gz from a URL, extract under
// ~/.weclank/carrots/<id>/, then hand off to the local-dir installer.
//
// We use the system `tar` and `unzip` binaries instead of pulling in a JS
// archive library — they're available on every macOS / Linux box, and on
// Windows users typically have tar bundled with modern PowerShell.

import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rename, rm, readdir, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir, homedir } from "node:os";
import { readManifest } from "./manifest";
import { installFromDir, type InstallResult } from "./store";
import type { CarrotPermissionGrant } from "./types";

const CARROTS_HOME = join(homedir(), ".weclank", "carrots");

export interface InstallFromUrlInput {
	url: string;
	granted: CarrotPermissionGrant;
	/** Optional explicit id; we always re-validate against the downloaded
	 * manifest, but pre-allocating the install dir keeps multiple in-flight
	 * downloads from racing each other. */
	expectedId?: string;
}

export async function installFromUrl(input: InstallFromUrlInput): Promise<InstallResult> {
	const url = input.url.trim();
	if (!/^https:\/\//.test(url)) {
		throw new Error(`URL must be https:// — got: ${url || "<empty>"}`);
	}

	const tmpRoot = await mkdtemp(join(tmpdir(), "weclank-carrot-"));
	const downloadPath = await downloadToTmp(url, tmpRoot);
	const extracted = await extractArchive(downloadPath, tmpRoot);

	// Find the directory containing carrot.json. Most zipballs nest the
	// project one level deep (e.g. `repo-main/...`), so we walk one level
	// of children if it isn't at the root.
	const carrotDir = await locateCarrotDir(extracted);
	const manifest = await readManifest(carrotDir);

	if (input.expectedId && manifest.id !== input.expectedId) {
		throw new Error(`Expected carrot id "${input.expectedId}" but downloaded "${manifest.id}"`);
	}

	// Final install location is the user's carrots dir, indexed by manifest id.
	const destDir = join(CARROTS_HOME, manifest.id);
	await mkdir(dirname(destDir), { recursive: true });
	await rm(destDir, { recursive: true, force: true });
	await rename(carrotDir, destDir);

	// Tidy up the rest of the temp tree.
	await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});

	return installFromDir({ sourcePath: destDir, granted: input.granted });
}

async function downloadToTmp(url: string, tmpRoot: string): Promise<string> {
	const ext = pickExtension(url);
	const dest = join(tmpRoot, `archive${ext}`);
	const res = await fetch(url, { redirect: "follow" });
	if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
	if (!res.body) throw new Error(`No body for ${url}`);
	await new Promise<void>((resolve, reject) => {
		const sink = createWriteStream(dest);
		sink.on("error", reject);
		sink.on("close", () => resolve());
		const reader = (res.body as ReadableStream<Uint8Array>).getReader();
		(async () => {
			try {
				while (true) {
					const { value, done } = await reader.read();
					if (done) break;
					if (!sink.write(value)) await new Promise<void>((r) => sink.once("drain", () => r()));
				}
				sink.end();
			} catch (err) { reject(err); }
		})();
	});
	return dest;
}

function pickExtension(url: string): string {
	const lower = url.toLowerCase();
	if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) return ".tar.gz";
	if (lower.endsWith(".zip")) return ".zip";
	// GitHub /zipball/<ref> and /archive/<ref>.zip both serve zip.
	if (lower.includes("/zipball/") || lower.includes(".zip")) return ".zip";
	if (lower.includes("/tarball/") || lower.includes(".tar")) return ".tar.gz";
	return ".zip";
}

async function extractArchive(archivePath: string, tmpRoot: string): Promise<string> {
	const extractDir = join(tmpRoot, "extracted");
	await mkdir(extractDir, { recursive: true });
	if (archivePath.endsWith(".zip")) {
		await runOrThrow("unzip", ["-q", archivePath, "-d", extractDir]);
	} else {
		await runOrThrow("tar", ["-xzf", archivePath, "-C", extractDir]);
	}
	return extractDir;
}

async function runOrThrow(cmd: string, args: string[]): Promise<void> {
	const proc = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe" });
	const [stderr, exit] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
	if (exit !== 0) {
		throw new Error(`${cmd} exited code=${exit}: ${stderr.slice(-400)}`);
	}
}

async function locateCarrotDir(rootDir: string): Promise<string> {
	if (await fileExists(join(rootDir, "carrot.json"))) return rootDir;
	for (const entry of await readdir(rootDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const candidate = join(rootDir, entry.name);
		if (await fileExists(join(candidate, "carrot.json"))) return candidate;
	}
	throw new Error(`No carrot.json found under ${rootDir}`);
}

async function fileExists(p: string): Promise<boolean> {
	try {
		const s = await stat(p);
		return s.isFile();
	} catch {
		return false;
	}
}
