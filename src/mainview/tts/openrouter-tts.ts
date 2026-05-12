// OpenRouter streaming provider. Uses the OpenAI-compatible
// /chat/completions endpoint with `stream: true` + `modalities:["text",
// "audio"]` + `audio.format: "pcm16"`. The response is SSE; each event's
// `choices[0].delta.audio.data` carries a base64-encoded PCM16 chunk.
//
// pcm16 from OpenAI's audio models is 24kHz mono — the streaming scheduler
// is configured accordingly. If a different upstream model returns a
// different rate this would need to be made dynamic.

import { StreamingTTSProvider, base64ToPCM16 } from "./streaming-provider";
import { ApiError, ConfigError } from "../core/errors";

const SAMPLE_RATE = 24_000;
const DEFAULT_MODEL = "openai/gpt-4o-audio-preview";
const DEFAULT_VOICE = "alloy";

export interface OpenRouterTTSOptions {
	apiKey: string;
	model?: string;
	voice?: string;
	/** `format` is exposed for non-streaming providers; streaming requires
	 * pcm16 so we ignore the field here. Kept for type-compat with the
	 * config dialog. */
	format?: string;
}

export class OpenRouterTTSProvider extends StreamingTTSProvider {
	readonly id = "openrouter";

	private apiKey: string;
	private model: string;
	private voice: string;

	constructor(opts: OpenRouterTTSOptions) {
		super(SAMPLE_RATE);
		if (!opts.apiKey) throw new ConfigError("OpenRouter requires an API key", "Set your OpenRouter API key in Voice settings before using this agent.");
		this.apiKey = opts.apiKey;
		this.model = opts.model || DEFAULT_MODEL;
		this.voice = opts.voice || DEFAULT_VOICE;
	}

	protected async synthesizeStreaming(
		text: string,
		onChunk: (pcm: Int16Array) => void,
		signal: AbortSignal,
	): Promise<void> {
		const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
			method: "POST",
			signal,
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
				"Content-Type": "application/json",
				"HTTP-Referer": "https://weclank.local",
				"X-Title": "Weclank",
			},
			body: JSON.stringify({
				model: this.model,
				stream: true,
				modalities: ["text", "audio"],
				audio: { voice: this.voice, format: "pcm16" },
				messages: [
					{
						role: "user",
						content: `Say exactly the following, with neutral delivery: ${text}`,
					},
				],
			}),
		});

		if (!response.ok) {
			const detail = await response.text().catch(() => "");
			throw new ApiError(response.status, "OpenRouter", detail || response.statusText);
		}
		const body = response.body;
		if (!body) throw new ApiError(0, "OpenRouter", "no response body");

		await parseSSE(body, (event) => {
			const data = event.data;
			if (!data || data === "[DONE]") return;
			let msg: unknown;
			try {
				msg = JSON.parse(data);
			} catch {
				return;
			}
			const audio = readAudioDelta(msg);
			if (audio) onChunk(base64ToPCM16(audio));
		}, signal);
	}
}

interface SSEEvent {
	data: string;
}

/** Minimal SSE parser. Splits on blank lines and concatenates `data:`
 * fields per event. Good enough for OpenAI-compatible streams. */
async function parseSSE(
	body: ReadableStream<Uint8Array>,
	onEvent: (event: SSEEvent) => void,
	signal: AbortSignal,
): Promise<void> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	signal.addEventListener("abort", () => void reader.cancel().catch(() => {}));

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		let split: number;
		while ((split = buffer.indexOf("\n\n")) >= 0) {
			const block = buffer.slice(0, split);
			buffer = buffer.slice(split + 2);
			const lines = block.split("\n");
			const dataLines = lines
				.filter((l) => l.startsWith("data:"))
				.map((l) => l.slice(5).trim());
			if (dataLines.length === 0) continue;
			onEvent({ data: dataLines.join("\n") });
		}
	}
}

function readAudioDelta(msg: unknown): string | undefined {
	if (typeof msg !== "object" || msg === null) return undefined;
	const choices = (msg as { choices?: unknown }).choices;
	if (!Array.isArray(choices)) return undefined;
	const first = choices[0] as { delta?: { audio?: { data?: unknown } } } | undefined;
	const data = first?.delta?.audio?.data;
	return typeof data === "string" ? data : undefined;
}
