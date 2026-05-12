// Serves finished MP4s and on-disk images over loopback so the WKWebView can
// use them in <video> / <img> (file:// is often blocked). Tokens are random;
// paths are never exposed in URLs.

import { randomUUID } from "node:crypto";
import { extname, resolve } from "node:path";
import { stat } from "node:fs/promises";

const previewMap = new Map<string, { path: string }>();

let server: ReturnType<typeof Bun.serve> | null = null;

function contentTypeForImagePath(filePath: string): string {
	const ext = extname(filePath).toLowerCase();
	switch (ext) {
		case ".png":
			return "image/png";
		case ".jpg":
		case ".jpeg":
			return "image/jpeg";
		case ".webp":
			return "image/webp";
		case ".gif":
			return "image/gif";
		default:
			return "application/octet-stream";
	}
}

function previewPort(): number {
	if (!server) {
		server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			async fetch(req) {
				const url = new URL(req.url);
				const mp4 = url.pathname.match(/^\/preview\/([^/]+)\.mp4$/);
				if (mp4) {
					const token = decodeURIComponent(mp4[1]!);
					const ent = previewMap.get(token);
					if (!ent) return new Response("Not found", { status: 404 });
					const file = Bun.file(ent.path);
					if (!(await file.exists())) return new Response("Missing", { status: 404 });
					return new Response(file, {
						headers: {
							"Content-Type": "video/mp4",
							"Accept-Ranges": "bytes",
							"Cache-Control": "no-store",
							"Access-Control-Allow-Origin": "*",
						},
					});
				}
				const img = url.pathname.match(/^\/preview-img\/([^/]+)$/);
				if (img) {
					const token = decodeURIComponent(img[1]!);
					const ent = previewMap.get(token);
					if (!ent) return new Response("Not found", { status: 404 });
					const file = Bun.file(ent.path);
					if (!(await file.exists())) return new Response("Missing", { status: 404 });
					const ct = contentTypeForImagePath(ent.path);
					return new Response(file, {
						headers: {
							"Content-Type": ct,
							"Cache-Control": "no-store",
							"Access-Control-Allow-Origin": "*",
						},
					});
				}
				return new Response("Not found", { status: 404 });
			},
		});
	}
	return server.port!;
}

export async function registerRecordingPreviewPath(absPath: string): Promise<
	{ ok: true; token: string; url: string } | { ok: false; error: string }
> {
	let resolved: string;
	try {
		resolved = resolve(absPath);
		const st = await stat(resolved);
		if (!st.isFile()) return { ok: false, error: "Not a regular file" };
	} catch {
		return { ok: false, error: "File not found" };
	}
	const token = randomUUID();
	previewMap.set(token, { path: resolved });
	const port = previewPort();
	const url = `http://127.0.0.1:${port}/preview/${encodeURIComponent(token)}.mp4`;
	return { ok: true, token, url };
}

export function unregisterRecordingPreviewToken(token: string): void {
	previewMap.delete(token);
}

/** Loopback URL for <img> from an absolute image path (token must be released). */
export async function registerImagePreviewPath(absPath: string): Promise<
	{ ok: true; token: string; url: string } | { ok: false; error: string }
> {
	let resolved: string;
	try {
		resolved = resolve(absPath);
		const st = await stat(resolved);
		if (!st.isFile()) return { ok: false, error: "Not a regular file" };
	} catch {
		return { ok: false, error: "File not found" };
	}
	const lower = resolved.toLowerCase();
	if (!/\.(png|jpe?g|gif|webp)$/.test(lower)) {
		return { ok: false, error: "Not a supported image file" };
	}
	const token = randomUUID();
	previewMap.set(token, { path: resolved });
	const port = previewPort();
	const url = `http://127.0.0.1:${port}/preview-img/${encodeURIComponent(token)}`;
	return { ok: true, token, url };
}
