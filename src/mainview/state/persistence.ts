// Serializes / restores StudioState from localStorage. Runtime-only fields
// (MediaStreams, the live/recording flags) are dropped — those re-acquire
// after a reload via getUserMedia, the Speak button, etc.
//
// Blob-URL model assets can't survive a reload (the Blob is gone), so we
// strip them and rely on the Edit → "Replace model" action to re-attach.

import { participantId, sceneId } from "../core/ids";
import type {
	Participant,
	Scene,
	SourcePlacement,
	StreamConfig,
	StreamOverlay,
	StudioOverlays,
	StudioState,
	TranscriptConfig,
} from "../core/types";

const STORAGE_KEY = "studio.state.v1";

interface PersistedParticipant {
	id: string;
	displayName: string;
	statusLine?: string;
	kind: Participant["kind"];
	visual?: { imageUrl?: string; backgroundColor?: string; animations?: { idle?: string; talking?: string } };
	tts?: Participant["tts"];
	banter?: Participant["banter"];
	videoDeviceId?: string;
	audioDeviceId?: string;
	muted: boolean;
	cameraOff: boolean;
	isAgent: boolean;
}

// Bump this when the persisted shape changes. Add a migrator to
// MIGRATIONS below that transforms version N → N+1. The chain runs on
// every load, so a user who's been away through several releases lands
// at the current shape without losing data.
const CURRENT_VERSION = 2;

interface PersistedState {
	version: typeof CURRENT_VERSION;
	scenes: Scene[];
	activeSceneId: string;
	participants: Record<string, PersistedParticipant>;
	stream: Pick<StreamConfig, "title" | "quality">;
	overlays?: StudioOverlays;
	transcript?: TranscriptConfig;
	/** Persistent stream overlays survive reload — useful when a title
	 * card is meant to stay up for hours. Transient notices (with
	 * expiresAt set) are filtered out at save time. */
	streamOverlays?: StreamOverlay[];
	musicVolume?: number;
}

/** Migrators from version N → N+1. Index 0 = v1 → v2, index 1 = v2 → v3,
 * etc. Each must set the new `version` and add/transform fields. */
const MIGRATIONS: Array<(input: Record<string, unknown>) => Record<string, unknown>> = [
	migrateV1ToV2,
];

/** v1 → v2: scenes carried `{ layoutId, slots: (ParticipantId|null)[] }`.
 * v2 carries `sources: SourcePlacement[]` where x/y/w/h are 0..1 ratios
 * and array order is z-order. The per-LayoutId rect math below mirrors
 * the old `layoutRects()` function in `stream-engine.ts` so any saved v1
 * composition renders identically after migration.
 *
 * Also drops the `viewports` field — the dual portrait/landscape model
 * is retired in v2. */
function migrateV1ToV2(v1: Record<string, unknown>): Record<string, unknown> {
	const scenes = Array.isArray(v1["scenes"]) ? (v1["scenes"] as Array<Record<string, unknown>>) : [];
	const nextScenes = scenes.map((scene) => {
		const layoutId = scene["layoutId"] as string | undefined;
		const slots = Array.isArray(scene["slots"]) ? (scene["slots"] as Array<string | null>) : [];
		const sources = layoutToPlacements(layoutId, slots);
		const { layoutId: _l, slots: _s, ...rest } = scene;
		void _l;
		void _s;
		return { ...rest, sources };
	});
	const { viewports: _v, ...rest } = v1;
	void _v;
	return { ...rest, version: 2, scenes: nextScenes };
}

/** Map the old layoutId + slot list to the new SourcePlacement[]. Rects
 * match `stream-engine.layoutRects()` from v1 verbatim. PIP's `w/4 - 24px`
 * inset at 1280×720 → `x ≈ 0.731, y ≈ 0.717, w = 0.25, h = 0.25`. */
function layoutToPlacements(layoutId: string | undefined, slots: Array<string | null>): SourcePlacement[] {
	const out: SourcePlacement[] = [];
	const push = (i: number, x: number, y: number, w: number, h: number): void => {
		const id = slots[i];
		if (!id) return;
		out.push({ participantId: id as Participant["id"], x, y, w, h, visible: true });
	};
	switch (layoutId) {
		case "single":
			push(0, 0, 0, 1, 1);
			break;
		case "split-2h":
			push(0, 0, 0, 1, 0.5);
			push(1, 0, 0.5, 1, 0.5);
			break;
		case "split-2v":
			push(0, 0, 0, 0.5, 1);
			push(1, 0.5, 0, 0.5, 1);
			break;
		case "pip":
			push(0, 0, 0, 1, 1);
			// w/4 - 24px inset at 1280×720: x=(1280-320-24)/1280≈0.731, y=(720-180-24)/720≈0.717
			push(1, 0.731, 0.717, 0.25, 0.25);
			break;
		case "grid-3":
			push(0, 0, 0, 1 / 3, 1);
			push(1, 1 / 3, 0, 1 / 3, 1);
			push(2, 2 / 3, 0, 1 / 3, 1);
			break;
		case "grid-4":
			push(0, 0, 0, 0.5, 0.5);
			push(1, 0.5, 0, 0.5, 0.5);
			push(2, 0, 0.5, 0.5, 0.5);
			push(3, 0.5, 0.5, 0.5, 0.5);
			break;
	}
	return out;
}

function migratePersisted(raw: unknown): PersistedState | null {
	if (!raw || typeof raw !== "object") return null;
	let current = raw as { version: number } & Record<string, unknown>;
	if (typeof current.version !== "number") return null;
	while (current.version < CURRENT_VERSION) {
		const v = current.version;
		const migrator = MIGRATIONS[v - 1];
		if (!migrator) {
			console.warn(`[persistence] no migrator for version ${v}; bailing`);
			return null;
		}
		current = migrator(current) as { version: number } & Record<string, unknown>;
	}
	if (current.version !== CURRENT_VERSION) return null;
	return current as unknown as PersistedState;
}

export function serializeState(state: StudioState): PersistedState {
	const participants: Record<string, PersistedParticipant> = {};
	for (const [id, p] of Object.entries(state.participants)) {
		participants[id] = {
			id: p.id,
			displayName: p.displayName,
			statusLine: p.statusLine,
			kind: p.kind,
			// Strip modelUrl: blob: URLs don't survive reload. imageUrl
			// can be persisted if it's a public URL — only drop blobs.
			visual: p.visual
				? {
						imageUrl: p.visual.imageUrl?.startsWith("blob:") ? undefined : p.visual.imageUrl,
						backgroundColor: p.visual.backgroundColor,
						animations: p.visual.animations,
					}
				: undefined,
			tts: p.tts,
			banter: p.banter,
			videoDeviceId: p.videoDeviceId,
			audioDeviceId: p.audioDeviceId,
			muted: p.muted,
			cameraOff: p.cameraOff,
			isAgent: p.isAgent,
		};
	}
	return {
		version: CURRENT_VERSION,
		scenes: state.scenes,
		activeSceneId: state.activeSceneId,
		participants,
		stream: { title: state.stream.title, quality: state.stream.quality },
		overlays: state.overlays,
		transcript: state.transcript,
		// Drop transient overlays (anything with an expiry). They were
		// always meant to be ephemeral and would clutter the restore.
		streamOverlays: state.streamOverlays.filter((o) => !o.expiresAt),
		musicVolume: state.music.volume,
	};
}

export function deserializeState(rawOrData: PersistedState | unknown): Partial<StudioState> | null {
	const data = migratePersisted(rawOrData);
	if (!data) return null;
	const participants: Record<string, Participant> = {};
	for (const [id, p] of Object.entries(data.participants)) {
		// Rebrand on the way out — the persisted JSON is plain strings.
		participants[id] = {
			...p,
			id: participantId(p.id),
			mediaStream: undefined,
			audioStream: undefined,
		};
	}
	return {
		scenes: data.scenes,
		activeSceneId: sceneId(data.activeSceneId),
		participants,
		stream: {
			title: data.stream.title,
			quality: data.stream.quality,
			recording: false,
			live: false,
		},
		overlays: data.overlays ?? {},
		transcript: data.transcript,
		streamOverlays: data.streamOverlays ?? [],
		music: { volume: data.musicVolume ?? 0.4, current: null },
	};
}

export async function hydrateFromUser(userId: string): Promise<Partial<StudioState> | null> {
	const { bunRpc } = await import("../rpc");
	const { state } = await bunRpc.userLoadState({ userId });
	if (!state) {
		return maybeMigrateLegacy(userId);
	}
	try {
		const parsed = JSON.parse(state) as PersistedState;
		return deserializeState(parsed);
	} catch (err) {
		console.warn("[persistence] parse failed, starting fresh", err);
		return null;
	}
}

/** Cache of the last serialized JSON we shipped. Skip the RPC round-trip
 * when nothing meaningful changed. The check is a plain string compare
 * after JSON.stringify — cheap relative to the SQLite write. */
let lastSavedJson: string | null = null;

export async function saveToStorage(state: StudioState): Promise<void> {
	const { bunRpc } = await import("../rpc");
	const { authStore } = await import("../auth/auth-store");
	const user = authStore.user;
	if (!user) return; // pre-login save attempt — discard
	const json = JSON.stringify(serializeState(state));
	if (json === lastSavedJson) return; // no actual change to persist
	try {
		await bunRpc.userSaveState({ userId: user.id, state: json });
		lastSavedJson = json;
	} catch (err) {
		console.warn("[persistence] save failed", err);
	}
}

/** Test hook + logout reset — clear the dedup cache so the next save
 * actually writes (e.g. when switching users). */
export function resetSaveCache(): void {
	lastSavedJson = null;
}

/** If we find legacy state in localStorage on the FIRST login, fold it
 * into the new account so the user doesn't lose scenes / participants.
 * Then wipe the legacy key. */
async function maybeMigrateLegacy(userId: string): Promise<Partial<StudioState> | null> {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as PersistedState;
		const { bunRpc } = await import("../rpc");
		await bunRpc.userSaveState({ userId, state: raw });
		// Migrate API keys too — best-effort, ignore failures.
		for (const lsKey of [
			"studio.tts.elevenlabsApiKey",
			"studio.tts.openrouterApiKey",
			"studio.tts.sunoApiKey",
		]) {
			const v = localStorage.getItem(lsKey);
			if (v) {
				const provider = lsKey.replace("studio.tts.", "").replace("ApiKey", "");
				await bunRpc.userSetSecret({ userId, key: provider, value: v });
			}
		}
		localStorage.removeItem(STORAGE_KEY);
		return deserializeState(parsed);
	} catch (err) {
		console.warn("[persistence] legacy migration failed", err);
		return null;
	}
}
