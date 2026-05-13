import { describe, expect, test } from "bun:test";
import { serializeState, deserializeState } from "./persistence";
import { participantId, sceneId, overlayId } from "../core/ids";
import { createDefaultRunOfShow } from "../producer/run-of-show";
import type { StudioState } from "../core/types";

function makeState(overrides: Partial<StudioState> = {}): StudioState {
	const host = participantId("host");
	return {
		scenes: [
			{
				id: sceneId("scene-1"),
				name: "Welcome",
				sources: [{ participantId: host, x: 0, y: 0, w: 1, h: 1, visible: true }],
			},
		],
		activeSceneId: sceneId("scene-1"),
		participants: {
			[host]: {
				id: host,
				displayName: "Dev",
				kind: "camera",
				muted: false,
				cameraOff: true,
				isAgent: false,
			},
		},
		stream: { title: "test", quality: "720p", recording: false, live: false },
		runOfShow: createDefaultRunOfShow(),
		overlays: {},
		streamOverlays: [],
		music: { volume: 0.4, current: null },
		focusedParticipantId: null,
		studioPrefs: { focusMode: "cohost" },
		...overrides,
	};
}

describe("persistence", () => {
	test("round-trips a clean state through serialize → deserialize", () => {
		const original = makeState();
		const persisted = serializeState(original);
		const restored = deserializeState(persisted);
		expect(restored).not.toBeNull();
		expect(restored!.scenes).toEqual(original.scenes);
		expect(restored!.activeSceneId).toBe(original.activeSceneId);
		expect(Object.keys(restored!.participants ?? {})).toEqual(Object.keys(original.participants));
		expect(restored!.runOfShow).toEqual(original.runOfShow);
	});

	test("strips MediaStream runtime fields", () => {
		const host = participantId("host");
		const fakeStream = {} as MediaStream;
		const original = makeState({
			participants: {
				[host]: {
					id: host,
					displayName: "Dev",
					kind: "camera",
					muted: false,
					cameraOff: true,
					isAgent: false,
					mediaStream: fakeStream,
					audioStream: fakeStream,
				},
			},
		});
		const persisted = serializeState(original);
		// Serialized JSON should not carry runtime stream refs.
		const json = JSON.stringify(persisted);
		expect(json).not.toContain("mediaStream");
		// After restore, runtime fields are explicitly cleared.
		const restored = deserializeState(persisted)!;
		const p = restored.participants![host]!;
		expect(p.mediaStream).toBeUndefined();
		expect(p.audioStream).toBeUndefined();
	});

	test("drops blob: image URLs but keeps remote http URLs", () => {
		const host = participantId("host");
		const remote = makeState({
			participants: {
				[host]: {
					id: host,
					displayName: "agent",
					kind: "voice-image",
					muted: false,
					cameraOff: false,
					isAgent: true,
					visual: { imageUrl: "https://example.com/a.png" },
				},
			},
		});
		expect(serializeState(remote).participants[host]!.visual?.imageUrl).toBe("https://example.com/a.png");

		const blob = makeState({
			participants: {
				[host]: {
					id: host,
					displayName: "agent",
					kind: "voice-image",
					muted: false,
					cameraOff: false,
					isAgent: true,
					visual: { imageUrl: "blob:https://studio.local/abc" },
				},
			},
		});
		expect(serializeState(blob).participants[host]!.visual?.imageUrl).toBeUndefined();
	});

	test("drops overlays with expiresAt set at serialize time", () => {
		const now = Date.now();
		const original = makeState({
			streamOverlays: [
				{
					id: overlayId("ov-perm"),
					kind: "title-card",
					props: { title: "permanent" },
					position: "top-left",
					createdAt: now,
				},
				{
					id: overlayId("ov-tmp"),
					kind: "notice",
					props: { body: "transient" },
					position: "top-right",
					createdAt: now,
					expiresAt: now + 5000,
				},
			],
		});
		const persisted = serializeState(original);
		expect(persisted.streamOverlays).toHaveLength(1);
		expect(persisted.streamOverlays![0]!.id).toBe(overlayId("ov-perm"));
	});

	test("round-trips studioPrefs (v3)", () => {
		const original = makeState({ studioPrefs: { focusMode: "broadcast" } });
		const restored = deserializeState(serializeState(original))!;
		expect(restored.studioPrefs?.focusMode).toBe("broadcast");
	});

	test("round-trips agent banter extended fields", () => {
		const host = participantId("host");
		const agent = participantId("p-agent-banter");
		const banter = {
			enabled: false,
			twitchChannel: "#stream",
			llmProvider: "openai" as const,
			llmModel: "gpt-5.5",
			systemPrompt: "Test persona",
			voiceActivityGate: false,
			proactiveOnTranscript: true,
			voiceContext: true,
			transcriptionProvider: "openai" as const,
			transcriptionModel: "whisper-1",
			visionProgramPreview: true,
			autonomyLevel: "auto-safe" as const,
			toolPermissions: { controlOverlays: true, controlMusic: false },
		};
		const original = makeState({
			participants: {
				[host]: {
					id: host,
					displayName: "Dev",
					kind: "camera",
					muted: false,
					cameraOff: true,
					isAgent: false,
				},
				[agent]: {
					id: agent,
					displayName: "Co-host",
					kind: "voice",
					muted: false,
					cameraOff: false,
					isAgent: true,
					banter,
				},
			},
		});
		const restored = deserializeState(serializeState(original))!;
		const b = restored.participants![agent]!.banter;
		expect(b).toEqual(banter);
	});

	test("returns null on version mismatch (future version)", () => {
		const bad = { version: 999, scenes: [], activeSceneId: "x", participants: {}, stream: { title: "", quality: "720p" } };
		expect(deserializeState(bad as never)).toBeNull();
	});

	test("resets stream.live and stream.recording on restore", () => {
		const original = makeState({
			stream: { title: "t", quality: "1080p", recording: true, live: true },
		});
		const restored = deserializeState(serializeState(original))!;
		expect(restored.stream!.live).toBe(false);
		expect(restored.stream!.recording).toBe(false);
	});
});

// ---------- v1 → v2 migration tests ----------
//
// Old shape: scenes carry `layoutId` + `slots: (ParticipantId|null)[]`.
// New shape: scenes carry `sources: SourcePlacement[]` with 0..1 ratios.
// The migrator must reproduce v1's `layoutRects()` math exactly so any
// saved composition renders identically post-migration.

function v1Scene(layoutId: string, slots: Array<string | null>): Record<string, unknown> {
	return { id: "scene-1", name: "Welcome", layoutId, slots };
}

function v1State(scene: Record<string, unknown>): Record<string, unknown> {
	return {
		version: 1,
		scenes: [scene],
		activeSceneId: "scene-1",
		participants: { host: { id: "host", displayName: "Dev", kind: "camera", muted: false, cameraOff: true, isAgent: false } },
		viewports: [{ id: "v-1", orientation: "landscape", label: "Main" }],
		stream: { title: "t", quality: "720p" },
	};
}

describe("v1 → v2 migration", () => {
	test("single layout → one source filling the canvas", () => {
		const out = deserializeState(v1State(v1Scene("single", ["host"])))!;
		expect(out.scenes![0]!.sources).toEqual([
			{ participantId: "host" as never, x: 0, y: 0, w: 1, h: 1, visible: true },
		]);
	});

	test("split-2h → two stacked sources at half height each", () => {
		const out = deserializeState(v1State(v1Scene("split-2h", ["a", "b"])))!;
		expect(out.scenes![0]!.sources).toEqual([
			{ participantId: "a" as never, x: 0, y: 0, w: 1, h: 0.5, visible: true },
			{ participantId: "b" as never, x: 0, y: 0.5, w: 1, h: 0.5, visible: true },
		]);
	});

	test("split-2v → two side-by-side sources at half width each", () => {
		const out = deserializeState(v1State(v1Scene("split-2v", ["a", "b"])))!;
		expect(out.scenes![0]!.sources).toEqual([
			{ participantId: "a" as never, x: 0, y: 0, w: 0.5, h: 1, visible: true },
			{ participantId: "b" as never, x: 0.5, y: 0, w: 0.5, h: 1, visible: true },
		]);
	});

	test("pip → main fills, second inset at bottom-right ¼", () => {
		const out = deserializeState(v1State(v1Scene("pip", ["main", "pip"])))!;
		const [a, b] = out.scenes![0]!.sources;
		expect(a).toEqual({ participantId: "main" as never, x: 0, y: 0, w: 1, h: 1, visible: true });
		expect(b!.participantId).toBe("pip" as never);
		expect(b!.w).toBe(0.25);
		expect(b!.h).toBe(0.25);
		expect(b!.x).toBeCloseTo(0.731, 3);
		expect(b!.y).toBeCloseTo(0.717, 3);
	});

	test("grid-3 → three columns full height", () => {
		const out = deserializeState(v1State(v1Scene("grid-3", ["a", "b", "c"])))!;
		expect(out.scenes![0]!.sources).toEqual([
			{ participantId: "a" as never, x: 0, y: 0, w: 1 / 3, h: 1, visible: true },
			{ participantId: "b" as never, x: 1 / 3, y: 0, w: 1 / 3, h: 1, visible: true },
			{ participantId: "c" as never, x: 2 / 3, y: 0, w: 1 / 3, h: 1, visible: true },
		]);
	});

	test("grid-4 → 2x2 grid", () => {
		const out = deserializeState(v1State(v1Scene("grid-4", ["a", "b", "c", "d"])))!;
		expect(out.scenes![0]!.sources).toEqual([
			{ participantId: "a" as never, x: 0, y: 0, w: 0.5, h: 0.5, visible: true },
			{ participantId: "b" as never, x: 0.5, y: 0, w: 0.5, h: 0.5, visible: true },
			{ participantId: "c" as never, x: 0, y: 0.5, w: 0.5, h: 0.5, visible: true },
			{ participantId: "d" as never, x: 0.5, y: 0.5, w: 0.5, h: 0.5, visible: true },
		]);
	});

	test("null slots are skipped, not emitted as placements", () => {
		const out = deserializeState(v1State(v1Scene("split-2v", ["only", null])))!;
		expect(out.scenes![0]!.sources).toHaveLength(1);
		expect(out.scenes![0]!.sources[0]!.participantId).toBe("only" as never);
	});

	test("v1 viewports field is dropped on restore", () => {
		const out = deserializeState(v1State(v1Scene("single", ["host"])))!;
		expect((out as Record<string, unknown>)["viewports"]).toBeUndefined();
	});
});
