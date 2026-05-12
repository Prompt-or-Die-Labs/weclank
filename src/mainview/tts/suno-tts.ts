// Suno provider — calls the community-wrapper API at api.sunoapi.org
// (override via TTSConfig.baseUrl for a different gateway). Suno generates
// FULL SONGS, not real-time speech; expect 30–120 seconds per call. Use
// for jingles / agent songs / intros rather than fast back-and-forth.
//
// Flow: POST /api/v1/generate → { taskId } → poll
// GET /api/v1/generate/record-info?taskId=… until status === "SUCCESS" →
// fetch the audio URL → arrayBuffer → BaseTTSProvider decodes + plays.

import { BaseTTSProvider, type SynthesisResult } from "./base-provider";
import { ApiError, ConfigError } from "../core/errors";

const DEFAULT_BASE_URL = "https://api.sunoapi.org";
const DEFAULT_MODEL = "V5_5";
// Suno's generator wants a callback URL even when polling; the API doesn't
// actually hit it when we poll, so a placeholder satisfies validation.
const CALLBACK_PLACEHOLDER = "https://studio.local/suno-callback";
const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 5 * 60_000;

export interface SunoTTSOptions {
	apiKey: string;
	baseUrl?: string;
	model?: string;
	style?: string;
	instrumental?: boolean;
}

interface SunoGenerateResponse {
	code?: number;
	msg?: string;
	data?: { taskId?: string };
}

interface SunoStatusItem {
	audioUrl?: string;
	streamAudioUrl?: string;
	status?: string;
}

interface SunoStatusResponse {
	code?: number;
	msg?: string;
	data?: {
		status?: string;
		response?: { sunoData?: SunoStatusItem[] };
		// older wrapper shapes:
		audioUrl?: string;
		clips?: SunoStatusItem[];
	};
}

export class SunoTTSProvider extends BaseTTSProvider {
	readonly id = "suno";

	private apiKey: string;
	private baseUrl: string;
	private model: string;
	private style: string | undefined;
	private instrumental: boolean;

	constructor(opts: SunoTTSOptions) {
		super();
		if (!opts.apiKey) throw new ConfigError("Suno requires an API key", "Set your Suno API key in Voice settings before using this agent.");
		this.apiKey = opts.apiKey;
		this.baseUrl = (opts.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
		this.model = opts.model || DEFAULT_MODEL;
		this.style = opts.style;
		this.instrumental = opts.instrumental ?? false;
	}

	protected async synthesize(text: string): Promise<SynthesisResult> {
		const taskId = await this.submit(text);
		const audioUrl = await this.pollUntilReady(taskId);
		const audioResponse = await fetch(audioUrl);
		if (!audioResponse.ok) {
			throw new ApiError(audioResponse.status, "Suno", "audio fetch failed");
		}
		return { bytes: await audioResponse.arrayBuffer(), mimeType: "audio/mpeg" };
	}

	private async submit(prompt: string): Promise<string> {
		const body: Record<string, unknown> = {
			customMode: this.style != null,
			instrumental: this.instrumental,
			prompt,
			model: this.model,
			callBackUrl: CALLBACK_PLACEHOLDER,
		};
		if (this.style) {
			body["style"] = this.style;
			body["title"] = prompt.slice(0, 60);
		}

		const response = await fetch(`${this.baseUrl}/api/v1/generate`, {
			method: "POST",
			headers: this.authHeaders(),
			body: JSON.stringify(body),
		});
		if (!response.ok) {
			throw new ApiError(response.status, "Suno", await response.text());
		}
		const parsed = (await response.json()) as SunoGenerateResponse;
		const taskId = parsed.data?.taskId;
		if (!taskId) {
			throw new ApiError(0, "Suno", `submit returned no taskId (${parsed.msg ?? "no message"})`);
		}
		return taskId;
	}

	private async pollUntilReady(taskId: string): Promise<string> {
		const deadline = Date.now() + POLL_TIMEOUT_MS;
		while (Date.now() < deadline) {
			await sleep(POLL_INTERVAL_MS);
			const url = `${this.baseUrl}/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`;
			const response = await fetch(url, { headers: this.authHeaders() });
			if (!response.ok) continue; // transient
			const parsed = (await response.json()) as SunoStatusResponse;
			const status = (parsed.data?.status ?? "").toUpperCase();
			const item = parsed.data?.response?.sunoData?.[0] ?? parsed.data?.clips?.[0];
			const audioUrl = item?.audioUrl ?? item?.streamAudioUrl ?? parsed.data?.audioUrl;
			if ((status === "SUCCESS" || status === "COMPLETE" || status === "FIRST_SUCCESS") && audioUrl) {
				return audioUrl;
			}
			if (status === "FAILED" || status === "ERROR") {
				throw new ApiError(0, "Suno", `generation failed: ${parsed.msg ?? "unknown"}`);
			}
		}
		throw new ApiError(0, "Suno", "generation timed out after 5 minutes");
	}

	private authHeaders(): Record<string, string> {
		return {
			Authorization: `Bearer ${this.apiKey}`,
			"Content-Type": "application/json",
			Accept: "application/json",
		};
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}
