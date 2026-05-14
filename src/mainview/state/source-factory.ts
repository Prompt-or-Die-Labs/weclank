// Creates participants of every supported SourceKind and slots them into
// the active scene. UI callers don't think about asset acquisition (file
// pickers, image URLs, TTS config) — they just say "make me a voice-vrm"
// and this resolves it.
//
// Returns the new participant id, or null if the user canceled the flow.

import { studio } from "./studio-store";
import { bunRpc } from "../rpc";
import { toast } from "../components/overlays";
import { audioMixer } from "../streaming/audio-mixer";
import { pickTTSConfig } from "../tts/config-dialog";
import { disposeVoiceRoute, initVoiceRoute } from "../tts/voice-route";
import { pickAssistantConfig } from "../banter/assistant-config-dialog";
import { pickInputDevice } from "./device-picker";
import { banterEngine } from "../banter/banter-engine";
import { mintId, participantId } from "../core/ids";
import { userMessageFor } from "../core/errors";
import type { ParticipantId } from "../core/ids";
import type { AssistantRole, Participant, SourceKind, TTSConfig, VisualConfig } from "../core/types";

interface CreateOptions {
	autoAssign?: boolean; // default true — drop into first empty slot
	startVideo?: boolean;
}

export async function createParticipantFromKind(
	kind: SourceKind,
	opts: CreateOptions = {},
): Promise<ParticipantId | null> {
	const id = mintId("p", participantId);
	// `isAgent` here means "uses our in-house TTS pipeline". Mic-only
	// sources are how external-voice agents join, so they're not flagged —
	// they behave like a normal mic participant. The conceptual
	// "this-is-an-agent" question is decoupled from the UI flow.
	const isAgent = kind === "voice" || kind === "voice-image" || kind === "voice-vrm" || kind === "voice-glb" || kind === "text";
	let displayName = defaultName(kind);
	let visual: VisualConfig | undefined;
	let tts: TTSConfig | undefined;
	let audioStream: MediaStream | undefined;
	let mediaStream: MediaStream | undefined;
	let videoDeviceId: string | undefined;
	let audioDeviceId: string | undefined;
	let assistantRole: AssistantRole | undefined;
	// Camera kind: default to "off" so we don't auto-request the device
	// at scene-add time. Flipped to "on" below if the user opted into the
	// combined mic flow, since at that point they've already granted
	// permission and the tracks are live.
	let cameraOff = kind === "camera" && opts.startVideo !== true;

	switch (kind) {
		case "camera": {
			// Pick which camera up front so the user gets the right one
			// (built-in vs. virtual webcam like OBS).
			const picked = await pickInputDevice("videoinput");
			if (!picked) return null;
			displayName = picked.label;
			videoDeviceId = picked.deviceId;
			if (opts.startVideo) {
				try {
					mediaStream = await navigator.mediaDevices.getUserMedia({
						video: { deviceId: { exact: picked.deviceId } },
						audio: false,
					});
					cameraOff = false;
				} catch (err) {
					toast(`Camera failed: ${userMessageFor(err)}`, "error");
					return null;
				}
				break;
			}

			// Optional: pair a mic with the camera. Critical for VAD —
			// the banter agent's "pause while I'm speaking" only works if
			// the dev's voice is in the mixer. Asking with confirm() is
			// crude but unambiguous; the user opts in once per source.
			const includeMic = window.confirm(
				"Include a microphone with this camera? Recommended — the banter agent uses it to know when you're speaking so it doesn't talk over you.",
			);
			if (includeMic) {
				const mic = await pickInputDevice("audioinput");
				if (mic) {
					audioDeviceId = mic.deviceId;
					try {
						// Pre-acquire the combined stream so VAD lights
						// up as soon as the tile mounts. The CameraRenderer
						// honors the videoDeviceId on its own getUserMedia,
						// so we only NEED the audio track here, but
						// capturing both at once shares a single permission
						// prompt.
						const combined = await navigator.mediaDevices.getUserMedia({
							video: { deviceId: { exact: picked.deviceId } },
							audio: { deviceId: { exact: mic.deviceId } },
						});
						mediaStream = combined;
						const audioTrack = combined.getAudioTracks()[0];
						if (audioTrack) {
							audioStream = new MediaStream([audioTrack]);
						}
						// User opted in and permission is granted — start
						// the camera visible.
						cameraOff = false;
					} catch (err) {
						toast(`Mic capture failed: ${userMessageFor(err)}`, "error");
					}
				}
			}
			break;
		}
		case "screen": {
			const md = navigator.mediaDevices as MediaDevices & {
				getDisplayMedia?: (c?: DisplayMediaStreamOptions) => Promise<MediaStream>;
			};
			if (!md?.getDisplayMedia) {
				toast(
					"Screen capture isn't supported in this build. Try the CEF build or upgrade your OS.",
					"error",
				);
				return null;
			}
			try {
				window.focus();
				mediaStream = await md.getDisplayMedia({ video: true, audio: false });
			} catch (err) {
				toast(`Screen capture failed: ${userMessageFor(err)}`, "error");
				return null;
			}
			break;
		}
		case "mic": {
			// Audio-only local capture — entry point for external-voice
			// agents that pipe audio through a virtual cable.
			const picked = await pickInputDevice("audioinput");
			if (!picked) return null;
			try {
				mediaStream = await navigator.mediaDevices.getUserMedia({
					audio: { deviceId: { exact: picked.deviceId } },
					video: false,
				});
				displayName = picked.label;
				audioDeviceId = picked.deviceId;
			} catch (err) {
				toast(`Couldn't open ${picked.label}: ${userMessageFor(err)}`, "error");
				return null;
			}
			break;
		}
		case "voice":
			break;
		case "voice-image": {
			const r = await bunRpc.pickImageFileForVoiceParticipant({});
			if (!r.canceled && r.path) {
				visual = { libraryImagePath: r.path };
				const seg = r.path.split(/[/\\]/).pop();
				if (seg) displayName = seg.replace(/\.[^.]+$/, "").slice(0, 48) || displayName;
				break;
			}
			if (r.error) {
				toast(r.error, "error");
				return null;
			}
			const url = window.prompt("Image URL (https://… or data URL). Leave empty to cancel.")?.trim();
			if (!url) return null;
			visual = { imageUrl: url };
			break;
		}
		case "text": {
			// Text-only assistant — no TTS, no canvas presence.
			// Configuration is handled entirely by pickAssistantConfig;
			// we return early from the factory after adding the participant.
			const setup = await pickAssistantConfig();
			if (!setup) return null;
			displayName = setup.displayName;
			assistantRole = setup.role;
			const textParticipant: Participant = {
				id,
				displayName,
				statusLine: "Text assistant",
				kind: "text",
				muted: false,
				cameraOff: true,
				isAgent: true,
				assistantRole,
				banter: setup.banterConfig,
			};
			const textCleanup = (): void => { banterEngine.stop(id); };
			studio.addParticipant(textParticipant, textCleanup);
			// Text agents don't go onto the canvas — no rendererFarm, no addSource.
			if (setup.banterConfig.enabled) {
				const started = banterEngine.start(id, setup.banterConfig);
				if (!started.ok) toast(`Assistant chat failed: ${started.error ?? "Unknown error"}`, "error");
			}
			return id;
		}
		case "voice-vrm":
		case "voice-glb": {
			const result = await bunRpc.pickModelFile({
				kind: kind === "voice-vrm" ? "vrm" : "glb",
			});
			if (result.canceled) return null;
			if (result.error || !result.base64) {
				toast(`Failed to load model: ${result.error ?? "unknown error"}`, "error");
				return null;
			}
			const blobUrl = base64ToBlobUrl(result.base64, "model/gltf-binary");
			visual = { modelUrl: blobUrl };
			if (result.name) displayName = result.name.replace(/\.[^.]+$/, "");
			break;
		}
	}

	if (isAgent) {
		const config = await pickTTSConfig();
		if (!config) {
			// User canceled. Revoke anything we created on their behalf.
			if (visual?.modelUrl?.startsWith("blob:")) URL.revokeObjectURL(visual.modelUrl);
			return null;
		}
		tts = config;
		try {
			audioStream = initVoiceRoute(id, config, { updateParticipant: false }).stream;
		} catch (err) {
			toast(`TTS init failed: ${userMessageFor(err)}`, "error");
			if (visual?.modelUrl?.startsWith("blob:")) URL.revokeObjectURL(visual.modelUrl);
			return null;
		}
	}

	const participant: Participant = {
		id,
		displayName,
		statusLine: isAgent ? "AI co-host" : kind === "mic" ? "External" : undefined,
		kind,
		muted: false,
		cameraOff,
		isAgent,
		visual,
		tts,
		videoDeviceId,
		audioDeviceId,
		mediaStream,
		audioStream,
		assistantRole,
	};

	// Cleanup: revoke Blob URLs, dispose the TTS provider, stop media
	// stream tracks, remove the audio mixer channel. Runs when
	// removeParticipant is called for any reason — explicit delete, scene
	// wipe, app teardown.
	const cleanup = (): void => {
		if (visual?.modelUrl?.startsWith("blob:")) {
			URL.revokeObjectURL(visual.modelUrl);
		}
		if (isAgent) {
			banterEngine.stop(id);
			disposeVoiceRoute(id);
		} else {
			audioMixer.removeInput(id);
		}
		mediaStream?.getTracks().forEach((t) => t.stop());
		// Tear down the offscreen renderer too. Dynamic import so this
		// module doesn't pull the renderer-farm graph into Bun-side
		// tests that import source-factory transitively.
		void import("../components/renderer-farm").then(({ rendererFarm }) => rendererFarm.dispose(id));
	};

	studio.addParticipant(participant, cleanup);

	// Renderer lives in the offscreen farm; create it now so frames are
	// ready when the StreamEngine composites this source.
	const { rendererFarm } = await import("../components/renderer-farm");
	try {
		await rendererFarm.ensureRenderer(participant);
	} catch (err) {
		studio.removeParticipant(id);
		toast(`Couldn't add ${displayName}: ${userMessageFor(err)}`, "error");
		return null;
	}

	if (opts.autoAssign !== false) {
		const scene = studio.activeScene;
		studio.addSource(scene.id, id);
	}

	return id;
}

/** Add a voice-image agent whose portrait is a file under the media library (absolute path). */
export async function addVoiceImageFromLibraryPath(
	libraryImagePath: string,
	opts: CreateOptions = {},
): Promise<ParticipantId | null> {
	const trimmed = libraryImagePath.trim();
	if (!trimmed) return null;
	const id = mintId("p", participantId);
	const seg = trimmed.split(/[/\\]/).pop();
	const displayName = (seg?.replace(/\.[^.]+$/, "") ?? defaultName("voice-image")).slice(0, 48);
	const visual: VisualConfig = { libraryImagePath: trimmed };
	const kind = "voice-image" as const;

	const config = await pickTTSConfig();
	if (!config) return null;
	const tts = config;
	let audioStream: MediaStream | undefined;
	try {
		audioStream = initVoiceRoute(id, config, { updateParticipant: false }).stream;
	} catch (err) {
		toast(`TTS init failed: ${userMessageFor(err)}`, "error");
		return null;
	}

	const participant: Participant = {
		id,
		displayName,
		statusLine: "AI co-host",
		kind,
		muted: false,
		cameraOff: false,
		isAgent: true,
		visual,
		tts,
		audioStream,
	};

	const cleanup = (): void => {
		banterEngine.stop(id);
		disposeVoiceRoute(id);
		void import("../components/renderer-farm").then(({ rendererFarm }) => rendererFarm.dispose(id));
	};

	studio.addParticipant(participant, cleanup);
	const { rendererFarm } = await import("../components/renderer-farm");
	try {
		await rendererFarm.ensureRenderer(participant);
	} catch (err) {
		studio.removeParticipant(id);
		toast(`Couldn't add ${displayName}: ${userMessageFor(err)}`, "error");
		return null;
	}
	if (opts.autoAssign !== false) {
		const scene = studio.activeScene;
		studio.addSource(scene.id, id);
	}
	return id;
}

function defaultName(kind: SourceKind): string {
	switch (kind) {
		case "camera": return "Camera";
		case "screen": return "Screen";
		case "mic": return "External agent";
		case "voice": return "Voice agent";
		case "voice-image": return "Image agent";
		case "voice-vrm": return "VRM agent";
		case "voice-glb": return "GLB agent";
		case "text": return "Assistant";
	}
}

function base64ToBlobUrl(base64: string, mime: string): string {
	const binary = atob(base64);
	const bytes = new Uint8Array(new ArrayBuffer(binary.length));
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	const blob = new Blob([bytes], { type: mime });
	return URL.createObjectURL(blob);
}
