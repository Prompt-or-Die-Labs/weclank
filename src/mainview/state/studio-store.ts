// Global studio state. One instance, imported anywhere that needs it.
// Stores keep their own narrow update API so components don't reach into the
// internal shape directly.

import { Store } from "../core/store";
import { saveToStorage } from "./persistence";
import { disposeTTSProvider } from "../tts/registry";
import { banterEngine } from "../banter/banter-engine";
import { chatOverlay } from "../streaming/chat-overlay";
import { audioMixer } from "../streaming/audio-mixer";
import { participantId, sceneId, mintId, showSegmentId } from "../core/ids";
import { PersistenceError } from "../core/errors";
import { defaultSourcePlacement, reorderSourceToTarget } from "./scene-composition";
import {
	addSegment,
	advanceSegment,
	completeSegment,
	createDefaultRunOfShow,
	createSegment,
	removeSegment,
	startSegment,
	updateSegment,
} from "../producer/run-of-show";
import type { ParticipantId, SceneId } from "../core/ids";
import type {
	Participant,
	RunOfShowState,
	Scene,
	ShowSegment,
	SourcePlacement,
	StudioPrefs,
	StudioState,
	StreamConfig,
	ChatOverlayConfig,
	TranscriptConfig,
	StreamOverlay,
	MusicTrack,
} from "../core/types";
import { DEFAULT_MEDIA_LIBRARY_CATEGORIES } from "../core/types";

const HOST_ID = participantId("host");

const DEFAULT_STREAM: StreamConfig = {
	title: "Weclank Live",
	quality: "720p",
	recording: false,
	live: false,
};

// Pre-seeded scenes on first signup. Each carries the host placement so
// the scene's thumbnail isn't empty before the user adds anything else.
// Twitch Studio's pattern: ship sensible starter scenes so a new user
// isn't staring at an empty list.
const SOLO_CAM_SCENE: Scene = {
	id: sceneId("scene-solo-cam"),
	name: "Solo Cam",
	sources: [
		{ participantId: HOST_ID, x: 0, y: 0, w: 1, h: 1, visible: true },
	],
};

const CODING_SCENE: Scene = {
	id: sceneId("scene-coding"),
	name: "Coding",
	// Host as picture-in-picture, bottom-right ¼. The user adds a screen
	// capture source separately; the layout-snap toolbar can re-arrange.
	sources: [
		{ participantId: HOST_ID, x: 0.731, y: 0.717, w: 0.25, h: 0.25, visible: true },
	],
};

const COHOST_SCENE: Scene = {
	id: sceneId("scene-cohost"),
	name: "AI Co-host Chat",
	// Side-by-side: host on the left, agent slot on the right (empty
	// until the user adds an AI co-host).
	sources: [
		{ participantId: HOST_ID, x: 0, y: 0, w: 0.5, h: 1, visible: true },
	],
};

const BRB_SCENE: Scene = {
	id: sceneId("scene-brb"),
	name: "BRB",
	sources: [], // intentionally empty — title-card overlays carry this scene
};

const initialParticipants: Record<string, Participant> = {
	[HOST_ID]: {
		id: HOST_ID,
		displayName: "Host",
		kind: "camera",
		muted: false,
		cameraOff: true,
		isAgent: false,
	},
};

const initial: StudioState = {
	scenes: [SOLO_CAM_SCENE, CODING_SCENE, COHOST_SCENE, BRB_SCENE],
	activeSceneId: SOLO_CAM_SCENE.id,
	participants: initialParticipants,
	stream: DEFAULT_STREAM,
	runOfShow: createDefaultRunOfShow(),
	overlays: {},
	streamOverlays: [],
	music: { volume: 0.4, current: null },
	focusedParticipantId: null,
	studioPrefs: {
		focusMode: "cohost",
		mediaLibraryCategories: [...DEFAULT_MEDIA_LIBRARY_CATEGORIES],
	},
};

class StudioStore extends Store<StudioState> {
	// Cleanup callbacks keyed by participant id. Whoever creates a
	// participant alongside disposable resources (Blob URLs, TTS providers,
	// MediaStream tracks) registers a teardown here so removeParticipant
	// runs them automatically. Keeps the store ignorant of TTS / Blob
	// internals while still owning the lifecycle.
	private participantCleanups = new Map<string, () => void>();
	private saveTimer: ReturnType<typeof setTimeout> | null = null;

	constructor() {
		super(initial);

		this.subscribe(() => this.scheduleSave());

		// Flush any pending save on window close — otherwise the last 400ms
		// of edits (or a half-finished scene rename) get lost if the user
		// quits during the debounce window.
		if (typeof window !== "undefined") {
			window.addEventListener("beforeunload", () => this.flushSave());
		}
	}

	installRestored(restored: Partial<StudioState> | null): void {
		if (!restored) return;
		this.participantCleanups.clear();
		const mergedPrefs = defaultStudioPrefs({
			...initial.studioPrefs,
			...restored.studioPrefs,
		});
		this.set({ ...initial, ...restored, studioPrefs: mergedPrefs });

		for (const rawId of Object.keys(restored.participants ?? {})) {
			const id = participantId(rawId);
			this.participantCleanups.set(id, () => {
				banterEngine.stop(id);
				disposeTTSProvider(id);
				audioMixer.removeInput(id);
			});
		}

		for (const p of Object.values(restored.participants ?? {})) {
			if (p.isAgent && p.banter?.enabled) {
				banterEngine.start(p.id, p.banter);
			}
		}

		if (restored.overlays?.chat?.enabled) {
			chatOverlay.start(restored.overlays.chat);
		}
	}

	private scheduleSave(): void {
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => {
			this.saveTimer = null;
			void saveToStorage(this.state);
		}, 400);
	}

	private flushSave(): void {
		if (this.saveTimer) {
			clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		void saveToStorage(this.state);
	}

	get activeScene(): Scene {
		const scene = this.state.scenes.find((s) => s.id === this.state.activeSceneId);
		if (!scene) {
			throw new PersistenceError(
				`No active scene with id ${this.state.activeSceneId}`,
				"Studio state is in a bad place. Try restarting — your scenes are saved.",
			);
		}
		return scene;
	}

	addScene(name: string): Scene {
		const scene: Scene = {
			id: mintId("scene", sceneId),
			name,
			sources: [],
		};
		this.set((s) => ({ scenes: [...s.scenes, scene] }));
		return scene;
	}

	activateScene(id: SceneId): void {
		this.set({ activeSceneId: id });
	}

	renameScene(id: SceneId, name: string): void {
		this.set((s) => ({
			scenes: s.scenes.map((scene) => (scene.id === id ? { ...scene, name } : scene)),
		}));
	}

	duplicateScene(id: SceneId): Scene | null {
		const source = this.state.scenes.find((s) => s.id === id);
		if (!source) return null;
		const copy: Scene = {
			...source,
			id: mintId("scene", sceneId),
			name: `${source.name} copy`,
			sources: source.sources.map((p) => ({ ...p })),
		};
		this.set((s) => ({ scenes: [...s.scenes, copy] }));
		return copy;
	}

	/** Append validated imported scenes (already minted ids). Activates the first import. */
	appendImportedScenes(scenes: Scene[]): void {
		if (scenes.length === 0) return;
		const first = scenes[0]!.id;
		this.set((s) => ({ scenes: [...s.scenes, ...scenes], activeSceneId: first }));
	}

	deleteScene(id: SceneId): void {
		this.set((s) => {
			const next = s.scenes.filter((sc) => sc.id !== id);
			const active = s.activeSceneId === id
				? next[0]?.id ?? s.activeSceneId
				: s.activeSceneId;
			return { scenes: next, activeSceneId: active };
		});
	}

	/** Drag-reorder helper: move `sourceId` to occupy `targetId`'s slot. */
	reorderScenes(sourceSceneId: SceneId, targetSceneId: SceneId): void {
		if (sourceSceneId === targetSceneId) return;
		this.set((s) => {
			const from = s.scenes.findIndex((sc) => sc.id === sourceSceneId);
			const to = s.scenes.findIndex((sc) => sc.id === targetSceneId);
			if (from < 0 || to < 0) return {};
			const next = s.scenes.slice();
			const [moved] = next.splice(from, 1);
			if (!moved) return {};
			next.splice(to, 0, moved);
			return { scenes: next };
		});
	}

	// ---------- Source-placement mutators ----------

	/** Add a participant to a scene's source list. Default placement is
	 * centered 50%×50%, visible, on top (last in array). If the participant
	 * is already in the scene, this is a no-op (call `bringToFront` to
	 * re-elevate). */
	addSource(targetSceneId: SceneId, pid: ParticipantId, placement?: Partial<SourcePlacement>): void {
		this.set((s) => ({
			scenes: s.scenes.map((scene) => {
				if (scene.id !== targetSceneId) return scene;
				if (scene.sources.some((p) => p.participantId === pid)) return scene;
				const next: SourcePlacement = { ...defaultSourcePlacement(pid), ...placement, participantId: pid };
				return { ...scene, sources: [...scene.sources, next] };
			}),
		}));
	}

	updateSourcePlacement(targetSceneId: SceneId, pid: ParticipantId, patch: Partial<SourcePlacement>): void {
		this.set((s) => ({
			scenes: s.scenes.map((scene) => {
				if (scene.id !== targetSceneId) return scene;
				return {
					...scene,
					sources: scene.sources.map((p) =>
						p.participantId === pid ? { ...p, ...patch, participantId: pid } : p,
					),
				};
			}),
		}));
	}

	removeSource(targetSceneId: SceneId, pid: ParticipantId): void {
		this.set((s) => ({
			scenes: s.scenes.map((scene) =>
				scene.id === targetSceneId
					? { ...scene, sources: scene.sources.filter((p) => p.participantId !== pid) }
					: scene,
			),
		}));
	}

	toggleSourceVisibility(targetSceneId: SceneId, pid: ParticipantId): void {
		this.set((s) => ({
			scenes: s.scenes.map((scene) => {
				if (scene.id !== targetSceneId) return scene;
				return {
					...scene,
					sources: scene.sources.map((p) =>
						p.participantId === pid ? { ...p, visible: !p.visible } : p,
					),
				};
			}),
		}));
	}

	bringToFront(targetSceneId: SceneId, pid: ParticipantId): void {
		this.set((s) => ({
			scenes: s.scenes.map((scene) => {
				if (scene.id !== targetSceneId) return scene;
				const without = scene.sources.filter((p) => p.participantId !== pid);
				const found = scene.sources.find((p) => p.participantId === pid);
				if (!found) return scene;
				return { ...scene, sources: [...without, found] };
			}),
		}));
	}

	sendToBack(targetSceneId: SceneId, pid: ParticipantId): void {
		this.set((s) => ({
			scenes: s.scenes.map((scene) => {
				if (scene.id !== targetSceneId) return scene;
				const without = scene.sources.filter((p) => p.participantId !== pid);
				const found = scene.sources.find((p) => p.participantId === pid);
				if (!found) return scene;
				return { ...scene, sources: [found, ...without] };
			}),
		}));
	}

	moveSourceUp(targetSceneId: SceneId, pid: ParticipantId): void {
		this.set((s) => ({
			scenes: s.scenes.map((scene) => {
				if (scene.id !== targetSceneId) return scene;
				const i = scene.sources.findIndex((p) => p.participantId === pid);
				if (i < 0 || i === scene.sources.length - 1) return scene;
				const next = scene.sources.slice();
				const a = next[i]!;
				const b = next[i + 1]!;
				next[i] = b;
				next[i + 1] = a;
				return { ...scene, sources: next };
			}),
		}));
	}

	moveSourceDown(targetSceneId: SceneId, pid: ParticipantId): void {
		this.set((s) => ({
			scenes: s.scenes.map((scene) => {
				if (scene.id !== targetSceneId) return scene;
				const i = scene.sources.findIndex((p) => p.participantId === pid);
				if (i <= 0) return scene;
				const next = scene.sources.slice();
				const a = next[i]!;
				const b = next[i - 1]!;
				next[i] = b;
				next[i - 1] = a;
				return { ...scene, sources: next };
			}),
		}));
	}

	reorderSourceToTarget(targetSceneId: SceneId, sourceId: ParticipantId, targetId: ParticipantId): void {
		this.set((s) => ({
			scenes: s.scenes.map((scene) =>
				scene.id === targetSceneId
					? { ...scene, sources: reorderSourceToTarget(scene.sources, sourceId, targetId) }
					: scene,
			),
		}));
	}

	// ---------- Participant mutators ----------

	addParticipant(p: Participant, cleanup?: () => void): void {
		if (cleanup) this.participantCleanups.set(p.id, cleanup);
		this.set((s) => ({ participants: { ...s.participants, [p.id]: p } }));
	}

	updateParticipant(id: ParticipantId, patch: Partial<Participant>): void {
		this.set((s) => {
			const existing = s.participants[id];
			if (!existing) return {};
			return { participants: { ...s.participants, [id]: { ...existing, ...patch } } };
		});
	}

	/** Replace or augment the cleanup callback for a participant. */
	setParticipantCleanup(id: ParticipantId, cleanup: () => void): void {
		this.participantCleanups.set(id, cleanup);
	}

	removeParticipant(id: ParticipantId): void {
		const cleanup = this.participantCleanups.get(id);
		this.participantCleanups.delete(id);
		try {
			cleanup?.();
		} catch (err) {
			console.warn("[studio] cleanup for", id, "failed", err);
		}
		this.set((s) => {
			const next = { ...s.participants };
			delete next[id];
			return {
				participants: next,
				scenes: s.scenes.map((scene) => ({
					...scene,
					sources: scene.sources.filter((p) => p.participantId !== id),
				})),
			};
		});
	}

	setStream(patch: Partial<StreamConfig>): void {
		this.set((s) => ({ stream: { ...s.stream, ...patch } }));
	}

	addRunSegment(): void {
		const segment = createSegment("New segment", 300, mintId("segment", showSegmentId));
		this.set((s) => ({ runOfShow: addSegment(s.runOfShow, segment) }));
	}

	updateRunSegment(id: ShowSegment["id"], patch: Partial<Pick<ShowSegment, "title" | "durationSec" | "notes">>): void {
		this.set((s) => ({ runOfShow: updateSegment(s.runOfShow, id, patch) }));
	}

	deleteRunSegment(id: ShowSegment["id"]): void {
		this.set((s) => ({ runOfShow: removeSegment(s.runOfShow, id) }));
	}

	startRunSegment(id: ShowSegment["id"]): void {
		this.set((s) => ({ runOfShow: startSegment(s.runOfShow, id, Date.now()) }));
	}

	completeRunSegment(id: ShowSegment["id"]): void {
		this.set((s) => ({ runOfShow: completeSegment(s.runOfShow, id, Date.now()) }));
	}

	advanceRunSegment(): void {
		this.set((s) => ({ runOfShow: advanceSegment(s.runOfShow, Date.now()) }));
	}

	resetRunOfShow(runOfShow: RunOfShowState = createDefaultRunOfShow()): void {
		this.set({ runOfShow });
	}

	setChatOverlay(config: ChatOverlayConfig): void {
		this.set((s) => ({ overlays: { ...s.overlays, chat: config } }));
		// Side-effect into the renderer immediately so the overlay reflects
		// the change without waiting for a restore boot.
		if (config.enabled && config.channel) chatOverlay.start(config);
		else chatOverlay.stop();
	}

	setTranscript(config: TranscriptConfig): void {
		this.set({ transcript: config });
	}

	upsertStreamOverlay(overlay: StreamOverlay): void {
		this.set((s) => {
			const existing = s.streamOverlays.findIndex((o) => o.id === overlay.id);
			const next = existing >= 0
				? s.streamOverlays.map((o, i) => (i === existing ? overlay : o))
				: [...s.streamOverlays, overlay];
			return { streamOverlays: next };
		});
	}

	removeStreamOverlay(id: import("../core/ids").OverlayId): boolean {
		const before = this.state.streamOverlays.length;
		this.set((s) => ({ streamOverlays: s.streamOverlays.filter((o) => o.id !== id) }));
		return this.state.streamOverlays.length < before;
	}

	clearStreamOverlays(): void {
		this.set({ streamOverlays: [] });
	}

	setMusicVolume(volume: number): void {
		this.set((s) => ({ music: { ...s.music, volume } }));
	}

	setCurrentMusic(track: MusicTrack | null): void {
		this.set((s) => ({ music: { ...s.music, current: track } }));
	}

	focusParticipant(id: ParticipantId | null): void {
		this.set({ focusedParticipantId: id });
	}

	setStudioPrefs(patch: Partial<StudioPrefs>): void {
		this.set((s) => ({
			studioPrefs: defaultStudioPrefs({ ...defaultStudioPrefs(s.studioPrefs), ...patch }),
		}));
	}
}

function defaultStudioPrefs(p?: StudioPrefs): StudioPrefs {
	const cats = DEFAULT_MEDIA_LIBRARY_CATEGORIES;
	if (!p) {
		return { focusMode: "cohost", mediaLibraryCategories: [...cats] };
	}
	return {
		focusMode: p.focusMode ?? "cohost",
		mediaLibraryRoot: p.mediaLibraryRoot,
		mediaLibraryCategories:
			p.mediaLibraryCategories !== undefined && p.mediaLibraryCategories.length > 0
				? p.mediaLibraryCategories
				: [...cats],
	};
}

export const studio = new StudioStore();
