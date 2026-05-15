// Eliza Cloud speech-to-text — OpenAI-compatible `POST /v1/audio/transcriptions`
// against `elizacloud.ai/api/v1`. Multipart body matches OpenAI's contract;
// Eliza Cloud documents itself as OpenAI-compatible for these endpoints.

import { getSecret } from "../auth/secrets-cache";
import { ELIZACLOUD_API_KEY } from "../auth/elizacloud-api";
import { ApiError, ConfigError } from "../core/errors";
import { withBackoff, isRetryableStatus } from "../../shared/retry";
import type { TranscribeResult } from "./openrouter-stt";

const ENDPOINT = "https://elizacloud.ai/api/v1/audio/transcriptions";

export const DEFAULT_ELIZACLOUD_TRANSCRIBE_MODEL = "whisper-1";

export const ELIZACLOUD_TRANSCRIBE_MODEL_OPTIONS: Array<{ id: string; label: string; note: string }> = [
	{ id: "whisper-1", label: "whisper-1", note: "OpenAI Whisper proxied via Eliza Cloud." },
	{ id: "gpt-4o-mini-transcribe", label: "gpt-4o-mini-transcribe", note: "Newer transcription model if Eliza Cloud exposes it." },
];

export async function transcribeWavElizaCloud(
	wav: ArrayBuffer,
	opts?: { model?: string; signal?: AbortSignal; language?: string },
): Promise<TranscribeResult> {
	const apiKey = getSecret(ELIZACLOUD_API_KEY);
	if (!apiKey) {
		throw new ConfigError(
			"No Eliza Cloud API key for transcription",
			"Settings → AI Providers → Connect Eliza Cloud, or pick a different STT provider.",
		);
	}
	const response = await withBackoff(
		async () => {
			const form = new FormData();
			form.append("file", new Blob([wav], { type: "audio/wav" }), "utterance.wav");
			form.append("model", opts?.model ?? DEFAULT_ELIZACLOUD_TRANSCRIBE_MODEL);
			if (opts?.language) form.append("language", opts.language);

			const r = await fetch(ENDPOINT, {
				method: "POST",
				signal: opts?.signal,
				headers: { Authorization: `Bearer ${apiKey}` },
				body: form,
			});
			if (!r.ok && isRetryableStatus(r.status)) {
				throw new ApiError(r.status, "Eliza Cloud STT", r.statusText);
			}
			return r;
		},
		{ maxAttempts: 3, initialDelayMs: 400, maxDelayMs: 3_000, signal: opts?.signal, onAttemptFailed: () => {} },
	);

	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		throw new ApiError(response.status, "Eliza Cloud STT", detail.slice(0, 280) || response.statusText);
	}

	const parsed = (await response.json()) as { text?: string; usage?: { cost?: number; seconds?: number } };
	return { text: (parsed.text ?? "").trim(), cost: parsed.usage?.cost ?? 0 };
}
