// Client helpers for the on-disk media library (root + categories in studio prefs).

import { bunRpc } from "../rpc";
import type { StudioPrefs } from "../core/types";
import { DEFAULT_MEDIA_LIBRARY_CATEGORIES } from "../core/types";

export function mediaLibraryCategories(prefs?: StudioPrefs): string[] {
	const c = prefs?.mediaLibraryCategories;
	if (c !== undefined && c.length > 0) return [...c];
	return [...DEFAULT_MEDIA_LIBRARY_CATEGORIES];
}

/** Strip `data:*;base64,` prefix and return raw base64. */
export function dataUrlToRawBase64(dataUrl: string): string {
	const i = dataUrl.indexOf("base64,");
	if (i === -1) return dataUrl;
	return dataUrl.slice(i + "base64,".length);
}

export async function savePngDataUrlToMediaLibrary(args: {
	rootPath: string;
	category: string;
	fileName: string;
	dataUrl: string;
}): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
	const base64 = dataUrlToRawBase64(args.dataUrl);
	const r = await bunRpc.saveMediaLibraryFile({
		rootPath: args.rootPath,
		category: args.category,
		fileName: args.fileName,
		base64,
	});
	if (!r.ok || !r.path) return { ok: false, error: r.error ?? "Save failed" };
	return { ok: true, path: r.path };
}
