// Thin adapter over the ElevenLabs music API. Reuses the user's stored
// ElevenLabs API key (same key as the TTS provider) so they don't enter
// it twice. Returns a synthetic { audioUrl, title, taskId } shape so
// MusicPlayer + the agent tools don't need to change.
//
// Endpoint: POST https://api.elevenlabs.io/v1/music
// Auth: xi-api-key header
// Returns: binary audio bytes (default mp3_44100_128).
//
// Music API requires a paid ElevenLabs plan; a 401/403 surfaces a
// friendly "API key rejected" toast via the shared ApiError path.

import { getStoredApiKey } from "../tts/registry";
import { ApiError, ConfigError } from "../core/errors";

const ENDPOINT = "https://api.elevenlabs.io/v1/music";
const DEFAULT_MODEL = "music_v1";
const DEFAULT_FORMAT = "mp3_44100_128";
const DEFAULT_LENGTH_MS = 30_000;

export interface MusicGenerationOptions {
	prompt: string;
	style?: string;
	instrumental?: boolean;
	model?: string;
	/** Override the generated track length in milliseconds (3000–600000). */
	musicLengthMs?: number;
	apiKey?: string;
}

export interface MusicGenerationResult {
	audioUrl: string;
	title: string;
	taskId: string;
}

export async function generateMusic(opts: MusicGenerationOptions): Promise<MusicGenerationResult> {
	const apiKey = opts.apiKey || getStoredApiKey("elevenlabs");
	if (!apiKey) {
		throw new ConfigError(
			"No ElevenLabs API key",
			"Save your ElevenLabs API key in any agent's Voice settings before generating music.",
		);
	}

	// ElevenLabs music takes a single text prompt — fold style hints in.
	const composed = opts.style ? `${opts.prompt}. Style: ${opts.style}` : opts.prompt;
	const prompt = opts.instrumental === false ? composed : `${composed}. Instrumental, no vocals.`;

	const body: Record<string, unknown> = {
		prompt,
		music_length_ms: clampLength(opts.musicLengthMs ?? DEFAULT_LENGTH_MS),
		output_format: DEFAULT_FORMAT,
		model_id: opts.model ?? DEFAULT_MODEL,
		force_instrumental: opts.instrumental !== false,
	};

	const response = await fetch(ENDPOINT, {
		method: "POST",
		headers: {
			"xi-api-key": apiKey,
			"Content-Type": "application/json",
			Accept: "audio/mpeg",
		},
		body: JSON.stringify(body),
	});
	if (!response.ok) {
		throw new ApiError(response.status, "ElevenLabs", await safeText(response));
	}
	const bytes = await response.arrayBuffer();
	const songId = response.headers.get("song_id") ?? response.headers.get("Song-Id");
	const taskId = songId || `el-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	const audioUrl = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
	return {
		audioUrl,
		title: opts.prompt.slice(0, 80),
		taskId,
	};
}

function clampLength(ms: number): number {
	if (!Number.isFinite(ms)) return DEFAULT_LENGTH_MS;
	return Math.max(3_000, Math.min(600_000, Math.round(ms)));
}

async function safeText(response: Response): Promise<string> {
	try { return await response.text(); } catch { return ""; }
}
