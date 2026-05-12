// OpenRouter STT — dedicated `/api/v1/audio/transcriptions` endpoint
// (OpenAI-compatible). Returns plain text plus a usage object that
// includes the actual per-request cost in USD. Cleaner than going through
// chat completions: smaller request, smaller response, and Whisper-class
// models are first-class here.
//
// Default model: `google/gemini-2.5-flash` — token-based pricing, very
// cheap (~$0.04/hr of conversational speech at typical pace). Swap to
// `openai/whisper-1` for higher accuracy on noisy mics; that one is
// duration-billed.

import { getStoredApiKey } from "../tts/registry";
import { ApiError, ConfigError } from "../core/errors";
import { withBackoff, isRetryableStatus } from "../core/retry";

export const DEFAULT_TRANSCRIBE_MODEL = "google/gemini-2.5-flash";

export const TRANSCRIBE_MODEL_OPTIONS: Array<{ id: string; label: string; note: string }> = [
	{ id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", note: "Cheap, token-priced. Good default." },
	{ id: "openai/whisper-1", label: "Whisper 1 (OpenAI)", note: "Best accuracy on noisy mics. Per-second billing." },
	{ id: "openai/gpt-4o-mini-transcribe", label: "gpt-4o-mini-transcribe", note: "Newer than Whisper, similar quality." },
	{ id: "openai/gpt-4o-transcribe", label: "gpt-4o-transcribe", note: "Top accuracy, more expensive." },
];

export interface TranscribeResult {
	text: string;
	/** Per-request cost in USD from the upstream provider. Zero when the
	 * provider doesn't include the field. */
	cost: number;
}

interface STTResponse {
	text?: string;
	usage?: {
		cost?: number;
		seconds?: number;
		total_tokens?: number;
	};
	error?: { message?: string };
}

export async function transcribeWav(
	wav: ArrayBuffer,
	opts?: { model?: string; signal?: AbortSignal; language?: string },
): Promise<TranscribeResult> {
	const apiKey = getStoredApiKey("openrouter");
	if (!apiKey) throw new ConfigError("No OpenRouter API key for transcription", "Set an OpenRouter API key in Voice settings first — mic transcription reuses it.");

	const base64 = arrayBufferToBase64(wav);
	const body: Record<string, unknown> = {
		model: opts?.model ?? DEFAULT_TRANSCRIBE_MODEL,
		input_audio: { data: base64, format: "wav" },
	};
	if (opts?.language) body["language"] = opts.language;

	const response = await withBackoff(
		async () => {
			const r = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
				method: "POST",
				signal: opts?.signal,
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
					"HTTP-Referer": "https://weclank.local",
					"X-Title": "Weclank mic transcribe",
				},
				body: JSON.stringify(body),
			});
			if (!r.ok && isRetryableStatus(r.status)) {
				throw new ApiError(r.status, "OpenRouter STT", r.statusText);
			}
			return r;
		},
		{ maxAttempts: 3, initialDelayMs: 400, maxDelayMs: 3_000, signal: opts?.signal, onAttemptFailed: () => {} },
	);
	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		throw new ApiError(response.status, "OpenRouter STT", detail.slice(0, 200) || response.statusText);
	}
	const parsed = (await response.json()) as STTResponse;
	if (parsed.error?.message) throw new ApiError(0, "OpenRouter STT", parsed.error.message);
	return {
		text: (parsed.text ?? "").trim(),
		cost: parsed.usage?.cost ?? 0,
	};
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = "";
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
}
