// Thin adapter over the Suno API for music generation. Reuses the user's
// stored Suno API key from the TTS storage so they don't enter it twice.
// Returns the raw audio bytes; MusicPlayer handles routing/playback.

import { getStoredApiKey } from "../tts/registry";
import { ApiError, ConfigError } from "../core/errors";

const DEFAULT_BASE_URL = "https://api.sunoapi.org";
const DEFAULT_MODEL = "V5_5";
const CALLBACK_PLACEHOLDER = "https://studio.local/suno-callback";
const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 5 * 60_000;

export interface MusicGenerationOptions {
	prompt: string;
	style?: string;
	instrumental?: boolean;
	model?: string;
	baseUrl?: string;
	apiKey?: string;
}

export interface MusicGenerationResult {
	audioUrl: string;
	title: string;
	taskId: string;
}

interface SubmitResponse {
	code?: number;
	msg?: string;
	data?: { taskId?: string };
}

interface StatusItem {
	audioUrl?: string;
	streamAudioUrl?: string;
	title?: string;
	status?: string;
}

interface StatusResponse {
	code?: number;
	msg?: string;
	data?: {
		status?: string;
		response?: { sunoData?: StatusItem[] };
		clips?: StatusItem[];
		audioUrl?: string;
	};
}

export async function generateMusic(opts: MusicGenerationOptions): Promise<MusicGenerationResult> {
	const apiKey = opts.apiKey || getStoredApiKey("suno");
	if (!apiKey) {
		throw new ConfigError(
			"No Suno API key",
			"Set a Suno API key in any agent's Voice settings → Suno provider before generating music.",
		);
	}
	const baseUrl = (opts.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
	const model = opts.model || DEFAULT_MODEL;
	const headers = {
		Authorization: `Bearer ${apiKey}`,
		"Content-Type": "application/json",
		Accept: "application/json",
	};

	const body: Record<string, unknown> = {
		customMode: opts.style != null,
		instrumental: opts.instrumental ?? true, // instrumental is the
		// default for stream BG — vocals fight the agent's voice.
		prompt: opts.prompt,
		model,
		callBackUrl: CALLBACK_PLACEHOLDER,
	};
	if (opts.style) {
		body["style"] = opts.style;
		body["title"] = opts.prompt.slice(0, 60);
	}

	const submitRes = await fetch(`${baseUrl}/api/v1/generate`, {
		method: "POST",
		headers,
		body: JSON.stringify(body),
	});
	if (!submitRes.ok) {
		throw new ApiError(submitRes.status, "Suno", await submitRes.text());
	}
	const submitted = (await submitRes.json()) as SubmitResponse;
	const taskId = submitted.data?.taskId;
	if (!taskId) throw new ApiError(0, "Suno", `submit returned no taskId (${submitted.msg ?? "no msg"})`);

	const deadline = Date.now() + POLL_TIMEOUT_MS;
	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
		const url = `${baseUrl}/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`;
		const res = await fetch(url, { headers });
		if (!res.ok) continue;
		const parsed = (await res.json()) as StatusResponse;
		const status = (parsed.data?.status ?? "").toUpperCase();
		const item = parsed.data?.response?.sunoData?.[0] ?? parsed.data?.clips?.[0];
		const audioUrl = item?.audioUrl ?? item?.streamAudioUrl ?? parsed.data?.audioUrl;
		if ((status === "SUCCESS" || status === "COMPLETE" || status === "FIRST_SUCCESS") && audioUrl) {
			return {
				audioUrl,
				title: item?.title ?? opts.prompt.slice(0, 80),
				taskId,
			};
		}
		if (status === "FAILED" || status === "ERROR") {
			throw new ApiError(0, "Suno", `generation failed: ${parsed.msg ?? "unknown"}`);
		}
	}
	throw new ApiError(0, "Suno", "generation timed out after 5 minutes");
}
