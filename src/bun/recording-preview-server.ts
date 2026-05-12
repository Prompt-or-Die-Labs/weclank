// Serves finished MP4s over loopback so the WKWebView can play them in <video>
// (file:// is often blocked). Tokens are random; paths are never exposed in URLs.

import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { stat } from "node:fs/promises";

const previewMap = new Map<string, { path: string }>();

let server: ReturnType<typeof Bun.serve> | null = null;

function previewPort(): number {
	if (!server) {
		server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			async fetch(req) {
				const url = new URL(req.url);
				const m = url.pathname.match(/^\/preview\/([^/]+)\.mp4$/);
				if (!m) return new Response("Not found", { status: 404 });
				const token = decodeURIComponent(m[1]!);
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
