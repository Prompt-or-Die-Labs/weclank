// On-disk media library under a user-chosen root: categorized subfolders,
// image saves, imports, and listing for the Media tab.

import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { basename, extname, join, normalize, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const IMAGE_RE = /\.(png|jpe?g|gif|webp)$/i;

export function isImageFileName(name: string): boolean {
	return IMAGE_RE.test(name);
}

/** Safe single path segment for a category folder. */
export function sanitizeMediaCategory(name: string): string {
	const t = name
		.trim()
		.replace(/[/\\]/g, "-")
		.replace(/\.\.+/g, "")
		.replace(/^\.+/, "")
		.slice(0, 80);
	return t || "Uncategorized";
}

export function safeMediaFileName(name: string): string {
	const base = basename(normalize(name)).replace(/[/\\]/g, "");
	const cleaned = base.replace(/[^\w.\-()+ ]+/g, "_").slice(0, 128);
	return cleaned || `asset-${randomUUID().slice(0, 8)}.png`;
}

export async function saveMediaLibraryBytes(args: {
	rootPath: string;
	category: string;
	fileName: string;
	bytes: Uint8Array<ArrayBuffer> | Buffer;
}): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
	try {
		const root = resolve(args.rootPath.trim());
		const cat = sanitizeMediaCategory(args.category);
		const fn = safeMediaFileName(args.fileName);
		if (!isImageFileName(fn)) {
			return { ok: false, error: "Only PNG, JPEG, WebP, or GIF file names are allowed" };
		}
		const dir = join(root, cat);
		await mkdir(dir, { recursive: true });
		const full = join(dir, fn);
		await Bun.write(full, args.bytes);
		return { ok: true, path: full };
	} catch (e) {
		return { ok: false, error: (e as Error).message };
	}
}

export type MediaLibraryListCategory = { name: string; files: Array<{ name: string; path: string }> };

export async function listMediaLibrary(args: {
	rootPath: string;
	categories: string[];
}): Promise<{ ok: true; categories: MediaLibraryListCategory[] } | { ok: false; error: string }> {
	try {
		const root = resolve(args.rootPath.trim());
		const out: MediaLibraryListCategory[] = [];
		const seen = new Set<string>();
		for (const raw of args.categories) {
			const cat = sanitizeMediaCategory(raw);
			if (seen.has(cat)) continue;
			seen.add(cat);
			const dir = join(root, cat);
			try {
				const entries = await readdir(dir, { withFileTypes: true });
				const files = entries
					.filter((d) => d.isFile() && isImageFileName(d.name))
					.map((d) => ({ name: d.name, path: join(dir, d.name) }))
					.sort((a, b) => a.name.localeCompare(b.name));
				out.push({ name: cat, files });
			} catch {
				out.push({ name: cat, files: [] });
			}
		}
		return { ok: true, categories: out };
	} catch (e) {
		return { ok: false, error: (e as Error).message };
	}
}

async function uniqueDestPath(destDir: string, fileName: string): Promise<string> {
	let base = basename(fileName);
	if (!isImageFileName(base)) {
		const ext = extname(base) || ".png";
		base = `import-${randomUUID().slice(0, 8)}${ext}`;
	}
	let candidate = join(destDir, base);
	let n = 1;
	const stem = base.replace(/(\.[^.]+)$/, "");
	const ext = extname(base) || ".png";
	while (true) {
		try {
			const f = Bun.file(candidate);
			if (!(await f.exists())) return candidate;
		} catch {
			return candidate;
		}
		n += 1;
		candidate = join(destDir, `${stem}-${n}${ext}`);
	}
}

export async function importFilesToMediaLibrary(args: {
	rootPath: string;
	category: string;
	sourcePaths: string[];
}): Promise<{ ok: true; copied: string[] } | { ok: false; error: string }> {
	try {
		const root = resolve(args.rootPath.trim());
		const cat = sanitizeMediaCategory(args.category);
		const destDir = join(root, cat);
		await mkdir(destDir, { recursive: true });
		const copied: string[] = [];
		for (const srcRaw of args.sourcePaths) {
			const src = resolve(srcRaw.trim());
			let st: Awaited<ReturnType<typeof stat>>;
			try {
				st = await stat(src);
			} catch {
				continue;
			}
			if (!st.isFile()) continue;
			if (!isImageFileName(src)) continue;
			const dest = await uniqueDestPath(destDir, basename(src));
			await copyFile(src, dest);
			copied.push(dest);
		}
		return { ok: true, copied };
	} catch (e) {
		return { ok: false, error: (e as Error).message };
	}
}
