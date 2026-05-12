// Shared domain types for the studio. Every component reads/writes these
// through the StudioStore.

import type { MusicTrackId, OverlayId, ParticipantId, SceneId } from "./ids";

export type SourceKind =
	| "camera" // human webcam
	| "screen" // human screen share
	| "mic" // audio-only from a local device — fits external-voice agents
	       // that pipe audio through a virtual cable (BlackHole, VB-Audio, etc.)
	| "voice" // agent: TTS-driven audio with reactive equalizer visual
	| "voice-image" // agent: TTS + static image
	| "voice-vrm" // agent: TTS + VRM avatar (lip-sync from amplitude)
	| "voice-glb" // agent: TTS + glTF/GLB model
	| "text"; // text-only assistant — no audio/video, output shown in chat + producer tray

/** Roles for text-only assistant participants. Each has a pre-canned system
 * prompt tuned to the Studio Live context; the user can override it. */
export type AssistantRole =
	| "co-host" // Chat co-host that responds to viewers, voiced reply in text
	| "chat-monitor" // Moderation, summaries, vibe checks
	| "producer" // Off-screen director — scene cues, music, pacing
	| "overlay-bot" // Tool-only: manages overlays and broadcast graphics
	| "code-narrator" // Reacts to coding feed / transcript activity
	| "custom"; // Fully custom prompt

export interface VisualConfig {
	imageUrl?: string;
	modelUrl?: string;
	backgroundColor?: string;
	// Animation triggers (idle, talking) — names match the model's clips.
	animations?: { idle?: string; talking?: string };
}

export type TTSProviderId = "elevenlabs" | "openrouter" | "suno";

export interface TTSConfig {
	provider: TTSProviderId;
	/** API key — may be absent when localStorage holds the canonical copy
	 * (one key per provider, see tts/registry.ts). */
	apiKey?: string;
	/** ElevenLabs voice id, or OpenAI voice name ("alloy" etc.). */
	voiceId?: string;
	/** Model id — provider-specific. */
	modelId?: string;
	/** Audio container — relevant for OpenRouter ("wav" | "mp3" | "flac"). */
	format?: string;
	/** Suno: override the API base URL (community wrappers like
	 * api.sunoapi.org vary). */
	baseUrl?: string;
	/** Suno: style hint ("lo-fi piano", "rock", …). */
	style?: string;
	/** Suno: render an instrumental track without vocals. */
	instrumental?: boolean;
}

export interface BanterConfig {
	/** When true, the engine is wired up; toggle without losing the rest of
	 * the config. */
	enabled: boolean;
	/** Anonymous read-only Twitch IRC. Empty string = no chat source (the
	 * agent stays idle until something else drives it). */
	twitchChannel: string;
	/** OpenRouter model id for the response LLM. Defaults to a fast cheap
	 * model. */
	llmModel: string;
	/** Personality + behavior. Short, role-defining; the engine appends
	 * recent chat history per turn. */
	systemPrompt: string;
	/** Pause the agent while a non-agent participant is speaking. Highly
	 * recommended — it stops the agent from talking over you. */
	voiceActivityGate: boolean;
	/** When true, the agent occasionally comments on coding-feed activity
	 * even with no chat. Requires the transcript watcher to be running. */
	proactiveOnTranscript: boolean;
	/** When true, transcribe the host's microphone and feed each utterance
	 * to the banter LLM as if it were a chat message authored by [host].
	 * Requires the mic transcription subsystem to find a non-agent audio
	 * source (a mic participant or camera+mic combo). */
	voiceContext?: boolean;
	/** Model id for mic transcription (OpenRouter audio/transcriptions
	 * endpoint). The mic transcriber is a studio-wide singleton, so the
	 * most recently-started banter session's value wins. */
	transcriptionModel?: string;
}

export interface Participant {
	id: ParticipantId;
	displayName: string;
	statusLine?: string; // lower-third secondary label, e.g. "sleep deprived"
	kind: SourceKind;
	visual?: VisualConfig;
	tts?: TTSConfig; // present on agent participants
	banter?: BanterConfig; // present on agents driven by chat + LLM
	/** Role for text-only (kind=="text") assistants. Determines the pre-canned
	 * system prompt and which capabilities are surfaced in the UI. */
	assistantRole?: AssistantRole;
	muted: boolean;
	cameraOff: boolean;
	/** Selected camera device id — captured at creation time so the
	 * CameraRenderer can request the right device when the user actually
	 * enables the camera. */
	videoDeviceId?: string;
	/** Selected audio input device id (for mic kind). */
	audioDeviceId?: string;
	// Runtime, not persisted:
	mediaStream?: MediaStream; // for camera/screen
	audioStream?: MediaStream; // for agent voice (TTS pipe)
	isAgent: boolean;
}

/** Where a participant sits inside a scene's canvas. Coordinates are
 * 0..1 ratios of the canvas dimensions so they survive resolution swaps
 * (720p ↔ 1080p, 16:9 ↔ 9:16). Array order in `Scene.sources` is the
 * z-order — later = drawn on top. */
export interface SourcePlacement {
	participantId: ParticipantId;
	x: number;
	y: number;
	w: number;
	h: number;
	visible: boolean;
}

export interface Scene {
	id: SceneId;
	name: string;
	sources: SourcePlacement[];
}

export type StreamQuality = "480p" | "720p" | "1080p";

export interface StreamConfig {
	title: string;
	quality: StreamQuality;
	recording: boolean;
	live: boolean;
}

export type OverlayPosition = "bottom-left" | "bottom-right" | "top-left" | "top-right" | "center" | "lower-third";
export type ChatOverlayPosition = "bottom-left" | "bottom-right" | "top-left" | "top-right";

export type StreamOverlayKind = "title-card" | "notice" | "code-snippet" | "lower-third" | "qr-code";

export interface StreamOverlayProps {
	title?: string;
	subtitle?: string;
	body?: string;
	language?: string; // for code-snippet
	accentColor?: string;
	imageUrl?: string;
}

export interface StreamOverlay {
	id: OverlayId;
	kind: StreamOverlayKind;
	props: StreamOverlayProps;
	position: OverlayPosition;
	createdAt: number;
	/** When set, the renderer drops this overlay automatically after the
	 * specified absolute timestamp (ms). Use for transient notices. */
	expiresAt?: number;
}

export interface MusicTrack {
	/** Stable id so the agent can reference it across calls. */
	id: MusicTrackId;
	/** Used in the HUD + an optional "Now playing" overlay. */
	title: string;
	/** The prompt that was sent to the generator (for the same purposes). */
	prompt?: string;
	/** Source — blob URL after generation, or a remote URL. */
	url: string;
	startedAt: number;
}

export interface ChatOverlayConfig {
	enabled: boolean;
	channel: string;
	position: ChatOverlayPosition;
	maxMessages: number;
}

export interface StudioOverlays {
	chat?: ChatOverlayConfig;
}

export interface TranscriptConfig {
	enabled: boolean;
	/** Path to a Claude Code / Codex JSONL session file. Empty = off. */
	path: string;
}

export interface StudioState {
	scenes: Scene[];
	activeSceneId: SceneId;
	/** Keyed by ParticipantId (just a branded string). Stored as
	 * Record<string, Participant> for ergonomics — branding lives on the
	 * participant.id field, which is the safety net at API boundaries. */
	participants: Record<string, Participant>;
	stream: StreamConfig;
	overlays: StudioOverlays;
	streamOverlays: StreamOverlay[];
	music: { volume: number; current: MusicTrack | null };
	transcript?: TranscriptConfig;
	// id of the participant whose lower-third / settings the user is editing
	focusedParticipantId: ParticipantId | null;
}
