// OpenAI Images API — used by banter tools (same `openai` platform key).

import { getSecret } from "../auth/secrets-cache";
import { OPENAI_API_KEY } from "../auth/openai-api";
import { ApiError, ConfigError } from "../core/errors";
import { withBackoff, isRetryableStatus } from "../../shared/retry";

export type OpenAiImageSize = "1024x1024" | "1792x1024" | "1024x1792";

export interface GenerateImageOptions {
	prompt: string;
	model?: string;
	size?: OpenAiImageSize;
	signal?: AbortSignal;
}

/** Returns a `data:image/png;base64,...` URL suitable for overlay `imageUrl`. */
export async function generateImageDataUrl(opts: GenerateImageOptions): Promise<{ dataUrl: string; revisedPrompt?: string }> {
	const apiKey = getSecret(OPENAI_API_KEY);
	if (!apiKey) {
		throw new ConfigError("No OpenAI API key for image generation", "Save an OpenAI API key in Settings first.");
	}

	const body = {
		model: opts.model ?? "dall-e-3",
		prompt: opts.prompt,
		n: 1,
		size: opts.size ?? "1024x1024",
		response_format: "b64_json" as const,
	};

	const response = await withBackoff(
		async () => {
			const r = await fetch("https://api.openai.com/v1/images/generations", {
				method: "POST",
				signal: opts.signal,
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body),
			});
			if (!r.ok && isRetryableStatus(r.status)) {
				throw new ApiError(r.status, "OpenAI Images", r.statusText);
			}
			return r;
		},
		{ maxAttempts: 2, initialDelayMs: 600, maxDelayMs: 4_000, signal: opts.signal, onAttemptFailed: () => {} },
	);

	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		throw new ApiError(response.status, "OpenAI Images", detail.slice(0, 400) || response.statusText);
	}

	const parsed = (await response.json()) as {
		data?: Array<{ b64_json?: string; revised_prompt?: string }>;
		error?: { message?: string };
	};
	if (parsed.error?.message) throw new ApiError(0, "OpenAI Images", parsed.error.message);
	const b64 = parsed.data?.[0]?.b64_json;
	if (!b64) throw new ApiError(0, "OpenAI Images", "No image data in response");
	const revised = parsed.data?.[0]?.revised_prompt;
	return {
		dataUrl: `data:image/png;base64,${b64}`,
		revisedPrompt: typeof revised === "string" ? revised : undefined,
	};
}
