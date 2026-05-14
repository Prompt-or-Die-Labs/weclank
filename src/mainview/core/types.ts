// Shared domain types for the studio. Every component reads/writes these
// through the StudioStore.

import type { MusicTrackId, OverlayId, ParticipantId, SceneId, ShowSegmentId } from "./ids";

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
 * prompt tuned to the Weclank context; the user can override it. */
export type AssistantRole =
	| "co-host" // Chat co-host that responds to viewers, voiced reply in text
	| "chat-monitor" // Moderation, summaries, vibe checks
	| "producer" // Off-screen director — scene cues, music, pacing
	| "overlay-bot" // Tool-only: manages overlays and broadcast graphics
	| "code-narrator" // Reacts to coding feed / transcript activity
	| "custom"; // Fully custom prompt

export interface VisualConfig {
	imageUrl?: string;
	/** Absolute path to a library image on disk; loaded via loopback preview in the image renderer. */
	libraryImagePath?: string;
	modelUrl?: string;
	backgroundColor?: string;
	// Animation triggers (idle, talking) — names match the model's clips.
	animations?: { idle?: string; talking?: string };
}

export type TTSProviderId = "elevenlabs" | "openrouter" | "suno" | "openai";

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

export type AgentAutonomyLevel = "suggested" | "auto-safe" | "full";

/** Which API hosts chat completions for an agent (tools + text). */
export type BanterLlmProvider = "openrouter" | "openai";

export interface AgentToolPermissions {
	controlOverlays: boolean;
	controlMusic: boolean;
}

export interface BanterConfig {
	/** When true, the engine is wired up; toggle without losing the rest of
	 * the config. */
	enabled: boolean;
	/** Anonymous read-only Twitch IRC. Empty string = no chat source (the
	 * agent stays idle until something else drives it). */
	twitchChannel: string;
	/** Where chat completions are sent. Defaults to OpenRouter for older saves. */
	llmProvider?: BanterLlmProvider;
	/** Model id — OpenRouter slugs (e.g. <code>openrouter/free</code>) or OpenAI Chat Completions ids (e.g. <code>gpt-5.3-codex</code>, <code>gpt-5.5</code>). */
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
	/** Mic STT backend. OpenRouter uses the stored OpenRouter key; OpenAI uses the platform `openai` key. */
	transcriptionProvider?: "openrouter" | "openai";
	/** Model id for mic transcription — OpenRouter slug or OpenAI transcription model, depending on `transcriptionProvider`. */
	transcriptionModel?: string;
	/** When true, attach a downscaled live program-preview JPEG to the latest user turn so vision-capable models can see the composited stream. */
	visionProgramPreview?: boolean;
	autonomyLevel?: AgentAutonomyLevel;
	toolPermissions?: AgentToolPermissions;
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

/** Platforms for which Weclank ships a brand glyph + RTMP preset. "custom"
 * covers any arbitrary RTMP endpoint. New platforms get added here, in
 * `core/icons.ts` (BRAND_PATHS / BRAND_COLORS / BRAND_LABELS), and in the
 * platform-defaults map in `streaming/channels.ts`. */
export type PlatformId =
	| "twitch"
	| "youtube"
	| "facebook"
	| "kick"
	| "rumble"
	| "x"
	| "tiktok"
	| "instagram"
	| "linkedin"
	| "custom";

/** A saved RTMP destination tied to a platform. The user can have many
 * linked channels; the current stream broadcasts to the subset whose ids
 * are in `StreamConfig.activeChannelIds`. */
export interface RtmpChannel {
	id: string;
	platform: PlatformId;
	/** User-given display label (e.g. "Main Twitch", "Backup YouTube"). */
	label: string;
	rtmpUrl: string;
	streamKey: string;
}

export interface StreamConfig {
	title: string;
	quality: StreamQuality;
	recording: boolean;
	live: boolean;
	/** Ids of channels selected for the current/next broadcast. Empty means
	 * "broadcast to every saved channel" (preserves single-destination
	 * behavior from before channels existed). */
	activeChannelIds?: string[];
}

export type ShowSegmentStatus = "upcoming" | "live" | "done";

export interface ShowSegment {
	id: ShowSegmentId;
	title: string;
	durationSec: number;
	notes?: string;
	status: ShowSegmentStatus;
	startedAt?: number;
	completedAt?: number;
}

export interface RunOfShowState {
	segments: ShowSegment[];
	activeSegmentId: ShowSegmentId | null;
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

/** Platforms whose chat we currently know how to read. Twitch and Kick
 * are anonymous WebSocket reads. YouTube is OAuth-polling (stub). The
 * other streaming destinations don't expose public chat APIs. */
export type ChatPlatformId = "twitch" | "kick" | "youtube";

export interface ChatOverlayConfig {
	enabled: boolean;
	/** Legacy field — was the Twitch channel name. Kept for back-compat;
	 * new code reads `channels.twitch` instead. Migrated on load. */
	channel: string;
	position: ChatOverlayPosition;
	maxMessages: number;
	/** Per-platform channel identifiers. Each non-empty value spawns a
	 * connector via ChatBus. Twitch + Kick: lowercase username. YouTube:
	 * the live video id or channel id (see chat/youtube-connector). */
	channels?: Partial<Record<ChatPlatformId, string>>;
}

export interface StudioOverlays {
	chat?: ChatOverlayConfig;
}

export interface TranscriptConfig {
	enabled: boolean;
	/** Path to a Claude Code / Codex JSONL session file. Empty = off. */
	path: string;
}

/** Persisted UI / onboarding preferences — safe to merge on restore. */
export type StudioFocusMode = "cohost" | "broadcast" | "full";

/** Default category folders under the media library root. */
export const DEFAULT_MEDIA_LIBRARY_CATEGORIES: string[] = ["QR codes", "Generated", "Uploads"];

export interface StudioPrefs {
	/** `cohost` keeps the coding loop visible; `full` exposes every tool tab. */
	focusMode?: StudioFocusMode;
	/** Absolute root directory for saved QR PNGs, generated stills, and imports. */
	mediaLibraryRoot?: string;
	/** Subfolder names under the library root (each becomes a category). */
	mediaLibraryCategories?: string[];
}

export interface StudioState {
	scenes: Scene[];
	activeSceneId: SceneId;
	/** Keyed by ParticipantId (just a branded string). Stored as
	 * Record<string, Participant> for ergonomics — branding lives on the
	 * participant.id field, which is the safety net at API boundaries. */
	participants: Record<string, Participant>;
	stream: StreamConfig;
	runOfShow: RunOfShowState;
	overlays: StudioOverlays;
	streamOverlays: StreamOverlay[];
	music: { volume: number; current: MusicTrack | null };
	transcript?: TranscriptConfig;
	// id of the participant whose lower-third / settings the user is editing
	focusedParticipantId: ParticipantId | null;
	/** Optional — merged from persistence; defaults applied in the store. */
	studioPrefs?: StudioPrefs;
}
