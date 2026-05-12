// Validated scene import — accepts a small scene-pack envelope OR the
// `scenes` array from a full Settings export (persisted state JSON).

import { mintId, participantId, sceneId } from "../core/ids";
import type { Scene, SourcePlacement } from "../core/types";

export const SCENE_PACK_VERSION = 1 as const;

export const SCENE_PACK_EXAMPLE = `{
  "weclankScenePack": 1,
  "scenes": [
    {
      "name": "Example — host full frame",
      "sources": [
        { "participantId": "host", "x": 0, "y": 0, "w": 1, "h": 1, "visible": true }
      ]
    }
  ]
}`;

export interface SceneImportResult {
	scenes: Scene[];
	warnings: string[];
}

const MAX_SCENES = 40;
const MAX_SOURCES_PER_SCENE = 20;
const MAX_SCENE_NAME = 120;

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Pull `scenes` from a scene pack or from a full persisted studio blob. */
export function extractRawScenes(parsed: unknown, warnings: string[]): unknown[] | null {
	if (!isRecord(parsed)) return null;
	if (parsed["weclankScenePack"] === SCENE_PACK_VERSION && Array.isArray(parsed["scenes"])) {
		return parsed["scenes"];
	}
	if (typeof parsed["version"] === "number" && Array.isArray(parsed["scenes"])) {
		const v = parsed["version"] as number;
		if (v < 1 || v > 99) warnings.push(`Unusual persisted version (${v}) — only scenes are read.`);
		return parsed["scenes"];
	}
	return null;
}

function isLegacyScene(row: Record<string, unknown>): boolean {
	return "layoutId" in row || "slots" in row;
}

function clamp01(n: number): number {
	if (!Number.isFinite(n)) return 0;
	return Math.min(1, Math.max(0, n));
}

function parseSource(
	raw: unknown,
	known: ReadonlySet<string>,
	sceneName: string,
	warnings: string[],
): SourcePlacement | null {
	if (!isRecord(raw)) return null;
	const pidRaw = raw["participantId"];
	if (typeof pidRaw !== "string" || !pidRaw.trim()) return null;
	const pid = pidRaw.trim();
	if (!known.has(pid)) {
		warnings.push(`Skipped source for unknown participant "${pid}" in scene "${sceneName}".`);
		return null;
	}
	const x = clamp01(Number(raw["x"]));
	const y = clamp01(Number(raw["y"]));
	let w = clamp01(Number(raw["w"]));
	let h = clamp01(Number(raw["h"]));
	if (w <= 0 || h <= 0) {
		w = Math.max(w, 0.01);
		h = Math.max(h, 0.01);
		warnings.push(`Adjusted zero-size source in "${sceneName}" to minimum 1% size.`);
	}
	const vis = raw["visible"];
	const visible = vis === false ? false : true;
	return {
		participantId: participantId(pid),
		x,
		y,
		w,
		h,
		visible,
	};
}

function parseOneScene(
	raw: unknown,
	known: ReadonlySet<string>,
	warnings: string[],
): Scene | null {
	if (!isRecord(raw)) return null;
	if (isLegacyScene(raw)) {
		warnings.push(`Skipped a scene that uses legacy layoutId/slots — export again from Weclank or use weclankScenePack format.`);
		return null;
	}
	const nameRaw = raw["name"];
	if (typeof nameRaw !== "string" || !nameRaw.trim()) return null;
	const name = nameRaw.trim().slice(0, MAX_SCENE_NAME);
	const sourcesRaw = raw["sources"];
	if (!Array.isArray(sourcesRaw)) return null;
	const sources: SourcePlacement[] = [];
	let i = 0;
	for (const s of sourcesRaw) {
		if (i >= MAX_SOURCES_PER_SCENE) {
			warnings.push(`Scene "${name}" had more than ${MAX_SOURCES_PER_SCENE} sources — extras dropped.`);
			break;
		}
		const pl = parseSource(s, known, name, warnings);
		if (pl) {
			sources.push(pl);
			i++;
		}
	}
	return {
		id: mintId("scene", sceneId),
		name,
		sources,
	};
}

/** Parse JSON; only sources whose participantId exists in `known` are kept. */
export function parseScenePackJson(
	rawJson: string,
	knownParticipantIds: ReadonlySet<string>,
): { ok: true; result: SceneImportResult } | { ok: false; error: string } {
	let parsed: unknown;
	try {
		parsed = JSON.parse(rawJson) as unknown;
	} catch {
		return { ok: false, error: "Invalid JSON — paste a scene pack or full export from Settings." };
	}
	const warnings: string[] = [];
	const rows = extractRawScenes(parsed, warnings);
	if (!rows) {
		return {
			ok: false,
			error: 'Expected `{ "weclankScenePack": 1, "scenes": [...] }` or a Settings export containing a `scenes` array.',
		};
	}
	if (rows.length === 0) return { ok: false, error: "The scenes array is empty." };
	if (rows.length > MAX_SCENES) {
		return { ok: false, error: `At most ${MAX_SCENES} scenes can be imported at once.` };
	}
	const scenes: Scene[] = [];
	let idx = 0;
	for (const row of rows) {
		idx++;
		const sc = parseOneScene(row, knownParticipantIds, warnings);
		if (sc) scenes.push(sc);
		else warnings.push(`Skipped invalid scene at index ${idx}.`);
	}
	if (scenes.length === 0) return { ok: false, error: "No valid scenes found after validation." };
	return { ok: true, result: { scenes, warnings } };
}
