// OpenAI Text-to-Speech — `POST /v1/audio/speech` (buffered MP3 → decode).

import { BaseTTSProvider, type SynthesisResult } from "./base-provider";
import { ApiError, ConfigError } from "../core/errors";

const DEFAULT_MODEL = "tts-1";
const DEFAULT_VOICE = "alloy";

export interface OpenAiSpeechTTSOptions {
	apiKey: string;
	model?: string;
	voice?: string;
}

export class OpenAiSpeechTTSProvider extends BaseTTSProvider {
	readonly id = "openai";

	private apiKey: string;
	private model: string;
	private voice: string;

	constructor(opts: OpenAiSpeechTTSOptions) {
		super();
		if (!opts.apiKey) throw new ConfigError("OpenAI requires an API key", "Save your OpenAI API key in Settings or Voice settings.");
		this.apiKey = opts.apiKey;
		this.model = opts.model || DEFAULT_MODEL;
		this.voice = opts.voice || DEFAULT_VOICE;
	}

	protected async synthesize(text: string): Promise<SynthesisResult> {
		const response = await fetch("https://api.openai.com/v1/audio/speech", {
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
			throw new ApiError(response.status, "OpenAI TTS", detail.slice(0, 200) || response.statusText);
		}
		const bytes = await response.arrayBuffer();
		return { bytes, mimeType: "audio/mpeg" };
	}
}
