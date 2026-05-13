// OpenAI native speech-to-text — `POST /v1/audio/transcriptions` with the
// same platform API key as Codex / banter OpenAI (`openai` in local secrets).

import { getSecret } from "../auth/secrets-cache";
import { OPENAI_API_KEY } from "../auth/openai-api";
import { ApiError, ConfigError } from "../core/errors";
import { withBackoff, isRetryableStatus } from "../core/retry";
import type { TranscribeResult } from "./openrouter-stt";

export const DEFAULT_OPENAI_TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe";

export const OPENAI_TRANSCRIBE_MODEL_OPTIONS: Array<{ id: string; label: string; note: string }> = [
	{ id: "gpt-4o-mini-transcribe", label: "gpt-4o-mini-transcribe", note: "Default — strong quality / cost balance." },
	{ id: "gpt-4o-transcribe", label: "gpt-4o-transcribe", note: "Highest accuracy; higher cost." },
	{ id: "whisper-1", label: "whisper-1", note: "Classic Whisper; per-minute pricing." },
];

export async function transcribeWavOpenAI(
	wav: ArrayBuffer,
	opts?: { model?: string; signal?: AbortSignal; language?: string },
): Promise<TranscribeResult> {
	const apiKey = getSecret(OPENAI_API_KEY);
	if (!apiKey) {
		throw new ConfigError(
			"No OpenAI API key for transcription",
			"Save an OpenAI API key in Settings, or set mic transcription back to OpenRouter.",
		);
	}

	const response = await withBackoff(
		async () => {
			const form = new FormData();
			form.append("file", new Blob([wav], { type: "audio/wav" }), "utterance.wav");
			form.append("model", opts?.model ?? DEFAULT_OPENAI_TRANSCRIBE_MODEL);
			if (opts?.language) form.append("language", opts.language);

			const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
				method: "POST",
				signal: opts?.signal,
				headers: { Authorization: `Bearer ${apiKey}` },
				body: form,
			});
			if (!r.ok && isRetryableStatus(r.status)) {
				throw new ApiError(r.status, "OpenAI STT", r.statusText);
			}
			return r;
		},
		{ maxAttempts: 3, initialDelayMs: 400, maxDelayMs: 3_000, signal: opts?.signal, onAttemptFailed: () => {} },
	);

	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		throw new ApiError(response.status, "OpenAI STT", detail.slice(0, 280) || response.statusText);
	}

	const parsed = (await response.json()) as {
		text?: string;
		usage?: { seconds?: number; total_tokens?: number };
		error?: { message?: string };
	};
	if (parsed.error?.message) throw new ApiError(0, "OpenAI STT", parsed.error.message);

	// OpenAI does not always return USD in this response; approximate 0 and
	// rely on dashboard for spend — keeps the perf HUD from lying.
	let cost = 0;
	if (typeof parsed.usage?.seconds === "number") {
		// Placeholder: $0.006/min order-of-magnitude for whisper-class is
		// handled in pricing docs; we avoid hard-coding model-specific rates.
		cost = (parsed.usage.seconds / 60) * 0.006;
	}

	return { text: (parsed.text ?? "").trim(), cost };
}
