import type { ParticipantId } from "../core/ids";
import type { Participant, Scene, SourcePlacement } from "../core/types";

export type LayoutPreset = "single" | "split-2v" | "split-2h" | "pip" | "grid-3" | "grid-4";

export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export interface BackstageEntry {
	participant: Participant;
	hiddenInScene: boolean;
}

export function defaultSourcePlacement(pid: ParticipantId): SourcePlacement {
	return { participantId: pid, x: 0.25, y: 0.25, w: 0.5, h: 0.5, visible: true };
}

export function centerPlacement(): Pick<SourcePlacement, "x" | "y" | "w" | "h"> {
	return { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
}

export function fitPlacement(): Pick<SourcePlacement, "x" | "y" | "w" | "h"> {
	return { x: 0, y: 0, w: 1, h: 1 };
}

export function visibleSources(scene: Scene): SourcePlacement[] {
	return scene.sources.filter((source) => source.visible);
}

export function layoutPresetRects(
	preset: LayoutPreset,
	count: number,
): Array<Pick<SourcePlacement, "x" | "y" | "w" | "h">> {
	switch (preset) {
		case "single":
			return [{ x: 0, y: 0, w: 1, h: 1 }];
		case "split-2v":
			return [
				{ x: 0, y: 0, w: 0.5, h: 1 },
				{ x: 0.5, y: 0, w: 0.5, h: 1 },
			].slice(0, count);
		case "split-2h":
			return [
				{ x: 0, y: 0, w: 1, h: 0.5 },
				{ x: 0, y: 0.5, w: 1, h: 0.5 },
			].slice(0, count);
		case "pip":
			return [
				{ x: 0, y: 0, w: 1, h: 1 },
				{ x: 0.731, y: 0.717, w: 0.25, h: 0.25 },
			].slice(0, count);
		case "grid-3":
			return [
				{ x: 0, y: 0, w: 1 / 3, h: 1 },
				{ x: 1 / 3, y: 0, w: 1 / 3, h: 1 },
				{ x: 2 / 3, y: 0, w: 1 / 3, h: 1 },
			].slice(0, count);
		case "grid-4":
			return [
				{ x: 0, y: 0, w: 0.5, h: 0.5 },
				{ x: 0.5, y: 0, w: 0.5, h: 0.5 },
				{ x: 0, y: 0.5, w: 0.5, h: 0.5 },
				{ x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
			].slice(0, count);
	}
}

export function applyLayoutPreset(
	scene: Scene,
	preset: LayoutPreset,
): Array<{ participantId: ParticipantId; placement: Pick<SourcePlacement, "x" | "y" | "w" | "h"> }> {
	const visible = visibleSources(scene);
	const rects = layoutPresetRects(preset, visible.length);
	return visible.flatMap((source, index) => {
		const placement = rects[index];
		return placement ? [{ participantId: source.participantId, placement }] : [];
	});
}

export function reorderSourceToTarget(
	sources: SourcePlacement[],
	sourceId: ParticipantId,
	targetId: ParticipantId,
): SourcePlacement[] {
	if (sourceId === targetId) return sources;
	const from = sources.findIndex((source) => source.participantId === sourceId);
	const to = sources.findIndex((source) => source.participantId === targetId);
	if (from < 0 || to < 0) return sources;
	const next = sources.slice();
	const [moved] = next.splice(from, 1);
	if (!moved) return sources;
	next.splice(to, 0, moved);
	return next;
}

export function topmostSourceAt(scene: Scene, x: number, y: number): SourcePlacement | null {
	for (let i = scene.sources.length - 1; i >= 0; i--) {
		const source = scene.sources[i];
		if (!source?.visible) continue;
		if (x >= source.x && x <= source.x + source.w && y >= source.y && y <= source.y + source.h) {
			return source;
		}
	}
	return null;
}

export function movePlacement(
	start: SourcePlacement,
	dx: number,
	dy: number,
): Pick<SourcePlacement, "x" | "y"> {
	return {
		x: clamp(start.x + dx, -start.w + 0.02, 1 - 0.02),
		y: clamp(start.y + dy, -start.h + 0.02, 1 - 0.02),
	};
}

export function resizePlacement(
	kind: ResizeHandle,
	start: SourcePlacement,
	dx: number,
	dy: number,
	preserveAspect: boolean,
	fromCenter: boolean,
): Pick<SourcePlacement, "x" | "y" | "w" | "h"> {
	const min = 0.04;
	let x = start.x;
	let y = start.y;
	let w = start.w;
	let h = start.h;

	const movesLeft = kind === "nw" || kind === "w" || kind === "sw";
	const movesRight = kind === "ne" || kind === "e" || kind === "se";
	const movesTop = kind === "nw" || kind === "n" || kind === "ne";
	const movesBottom = kind === "sw" || kind === "s" || kind === "se";

	if (movesLeft) {
		const factor = fromCenter ? 2 : 1;
		x = start.x + dx;
		w = start.w - dx * factor;
	} else if (movesRight) {
		const factor = fromCenter ? 2 : 1;
		w = start.w + dx * factor;
		if (fromCenter) x = start.x - dx;
	}

	if (movesTop) {
		const factor = fromCenter ? 2 : 1;
		y = start.y + dy;
		h = start.h - dy * factor;
	} else if (movesBottom) {
		const factor = fromCenter ? 2 : 1;
		h = start.h + dy * factor;
		if (fromCenter) y = start.y - dy;
	}

	if (preserveAspect && (movesLeft || movesRight) && (movesTop || movesBottom)) {
		const aspect = start.w / start.h;
		const nextH = w / aspect;
		if (movesTop) y += h - nextH;
		h = nextH;
	}

	if (w < min) {
		if (movesLeft) x = start.x + start.w - min;
		w = min;
	}
	if (h < min) {
		if (movesTop) y = start.y + start.h - min;
		h = min;
	}

	return {
		x: clamp(x, -w + 0.02, 1 - 0.02),
		y: clamp(y, -h + 0.02, 1 - 0.02),
		w,
		h,
	};
}

export function backstageEntries(
	scene: Scene,
	participants: Record<string, Participant>,
): BackstageEntry[] {
	const inScene = new Map(scene.sources.map((source) => [source.participantId, source] as const));
	const entries: BackstageEntry[] = [];
	for (const participant of Object.values(participants)) {
		const placement = inScene.get(participant.id);
		if (!placement) {
			entries.push({ participant, hiddenInScene: false });
		} else if (!placement.visible) {
			entries.push({ participant, hiddenInScene: true });
		}
	}
	return entries;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}
