import { describe, expect, test } from "bun:test";
import { participantId, sceneId } from "../core/ids";
import type { Participant, Scene, SourcePlacement } from "../core/types";
import {
	applyLayoutPreset,
	backstageEntries,
	movePlacement,
	reorderSourceToTarget,
	resizePlacement,
	topmostSourceAt,
} from "./scene-composition";

const a = participantId("a");
const b = participantId("b");
const c = participantId("c");

function scene(sources: SourcePlacement[]): Scene {
	return { id: sceneId("scene"), name: "Scene", sources };
}

function source(id: typeof a, x = 0, y = 0, w = 1, h = 1, visible = true): SourcePlacement {
	return { participantId: id, x, y, w, h, visible };
}

describe("scene composition", () => {
	test("applies layout presets to visible sources only", () => {
		const current = scene([
			source(a),
			source(b),
			source(c, 0, 0, 1, 1, false),
		]);

		expect(applyLayoutPreset(current, "split-2v")).toEqual([
			{ participantId: a, placement: { x: 0, y: 0, w: 0.5, h: 1 } },
			{ participantId: b, placement: { x: 0.5, y: 0, w: 0.5, h: 1 } },
		]);
	});

	test("reorders a source to the target slot", () => {
		const sources = [source(a), source(b), source(c)];
		expect(reorderSourceToTarget(sources, c, a).map((s) => s.participantId)).toEqual([c, a, b]);
		expect(reorderSourceToTarget(sources, a, c).map((s) => s.participantId)).toEqual([b, c, a]);
	});

	test("hit-tests the topmost visible source", () => {
		const current = scene([
			source(a, 0, 0, 1, 1),
			source(b, 0.25, 0.25, 0.5, 0.5),
			source(c, 0.4, 0.4, 0.2, 0.2, false),
		]);

		expect(topmostSourceAt(current, 0.5, 0.5)?.participantId).toBe(b);
		expect(topmostSourceAt(current, 0.9, 0.9)?.participantId).toBe(a);
		expect(topmostSourceAt(current, 1.1, 0.5)).toBeNull();
	});

	test("move and resize preserve canvas guardrails", () => {
		const placement = source(a, 0.1, 0.1, 0.2, 0.2);
		const moved = movePlacement(placement, -1, -1);
		expect(moved.x).toBeCloseTo(-0.18);
		expect(moved.y).toBeCloseTo(-0.18);
		const resized = resizePlacement("nw", placement, 0.5, 0.5, false, false);
		expect(resized.w).toBe(0.04);
		expect(resized.h).toBe(0.04);
	});

	test("projects backstage participants", () => {
		const participants: Record<string, Participant> = {
			[a]: { id: a, displayName: "A", kind: "camera", muted: false, cameraOff: true, isAgent: false },
			[b]: { id: b, displayName: "B", kind: "screen", muted: false, cameraOff: false, isAgent: false },
			[c]: { id: c, displayName: "C", kind: "voice", muted: false, cameraOff: true, isAgent: true },
		};
		const current = scene([source(a), source(b, 0, 0, 1, 1, false)]);

		expect(backstageEntries(current, participants).map((entry) => [entry.participant.id, entry.hiddenInScene])).toEqual([
			[b, true],
			[c, false],
		]);
	});
});
