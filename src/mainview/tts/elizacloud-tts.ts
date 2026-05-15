// Eliza Cloud Text-to-Speech — OpenAI-compatible `POST /v1/audio/speech`
// against `elizacloud.ai/api/v1`. Same buffered-MP3-decode path as the
// OpenAI provider. Voice ids depend on the Eliza Cloud catalog; default
// to `alloy` since their docs claim OpenAI compatibility.

import { BaseTTSProvider, type SynthesisResult } from "./base-provider";
import { ApiError, ConfigError } from "../core/errors";

const ENDPOINT = "https://elizacloud.ai/api/v1/audio/speech";
const DEFAULT_MODEL = "tts-1";
const DEFAULT_VOICE = "alloy";

export interface ElizaCloudTTSOptions {
	apiKey: string;
	model?: string;
	voice?: string;
}

export class ElizaCloudTTSProvider extends BaseTTSProvider {
	readonly id = "elizacloud";

	private apiKey: string;
	private model: string;
	private voice: string;

	constructor(opts: ElizaCloudTTSOptions) {
		super();
		if (!opts.apiKey) {
			throw new ConfigError(
				"Eliza Cloud requires an API key",
				"Settings → AI Providers → Connect Eliza Cloud before using this voice.",
			);
		}
		this.apiKey = opts.apiKey;
		this.model = opts.model || DEFAULT_MODEL;
		this.voice = opts.voice || DEFAULT_VOICE;
	}

	protected async synthesize(text: string): Promise<SynthesisResult> {
		const response = await fetch(ENDPOINT, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: this.model,
				voice: this.voice,
				input: text,
				response_format: "mp3",
			}),
		});
		if (!response.ok) {
			const detail = await response.text().catch(() => "");
			throw new ApiError(response.status, "Eliza Cloud TTS", detail.slice(0, 200) || response.statusText);
		}
		const bytes = await response.arrayBuffer();
		return { bytes, mimeType: "audio/mpeg" };
	}
}
