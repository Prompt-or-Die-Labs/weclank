import { describe, expect, it } from "bun:test";
import { participantId } from "../core/ids";
import { parseScenePackJson, SCENE_PACK_VERSION } from "./scene-import";

describe("parseScenePackJson", () => {
	const known = new Set(["host", "p-abc123"]);

	it("accepts weclankScenePack envelope", () => {
		const raw = JSON.stringify({
			weclankScenePack: SCENE_PACK_VERSION,
			scenes: [{ name: "A", sources: [{ participantId: "host", x: 0, y: 0, w: 1, h: 1 }] }],
		});
		const r = parseScenePackJson(raw, known);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.result.scenes).toHaveLength(1);
		expect(r.result.scenes[0]!.name).toBe("A");
		expect(r.result.scenes[0]!.sources).toHaveLength(1);
		expect(r.result.scenes[0]!.sources[0]!.participantId).toEqual(participantId("host"));
		expect(r.result.scenes[0]!.id.startsWith("scene-")).toBe(true);
	});

	it("accepts persisted export shape with version + scenes", () => {
		const raw = JSON.stringify({
			version: 3,
			scenes: [{ name: "From export", sources: [{ participantId: "p-abc123", x: 0.1, y: 0.2, w: 0.5, h: 0.5, visible: false }] }],
		});
		const r = parseScenePackJson(raw, known);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.result.scenes[0]!.sources[0]!.visible).toBe(false);
	});

	it("drops unknown participants with warning", () => {
		const raw = JSON.stringify({
			weclankScenePack: 1,
			scenes: [{ name: "X", sources: [{ participantId: "ghost", x: 0, y: 0, w: 1, h: 1 }] }],
		});
		const r = parseScenePackJson(raw, known);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.result.scenes[0]!.sources).toHaveLength(0);
		expect(r.result.warnings.some((w) => w.includes("ghost"))).toBe(true);
	});

	it("rejects when every scene is legacy or invalid", () => {
		const raw = JSON.stringify({
			weclankScenePack: 1,
			scenes: [{ name: "Old", layoutId: "grid", slots: [] }],
		});
		const r = parseScenePackJson(raw, known);
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error).toContain("No valid");
	});

	it("imports valid scenes and skips legacy rows with warnings", () => {
		const raw = JSON.stringify({
			weclankScenePack: 1,
			scenes: [
				{ name: "Old", layoutId: "grid", slots: [] },
				{ name: "Good", sources: [{ participantId: "host", x: 0, y: 0, w: 0.5, h: 0.5 }] },
			],
		});
		const r = parseScenePackJson(raw, known);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.result.scenes).toHaveLength(1);
		expect(r.result.scenes[0]!.name).toBe("Good");
		expect(r.result.warnings.some((w) => w.includes("legacy"))).toBe(true);
	});

	it("rejects invalid JSON", () => {
		const r = parseScenePackJson("{", known);
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error).toContain("JSON");
	});

	it("rejects missing scenes", () => {
		const r = parseScenePackJson("{}", known);
		expect(r.ok).toBe(false);
	});
});
