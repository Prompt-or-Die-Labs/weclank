// ElevenLabs streaming provider — uses the WebSocket "stream-input" endpoint
// for sub-200ms first-byte latency. Audio comes back as base64 PCM chunks
// (output_format=pcm_22050) which feed straight into the streaming
// scheduler — no MSE, no per-chunk codec decoding.
//
// Protocol summary:
//   1. ws open → send initial message with api key and voice settings
//   2. send text in chunks (or one shot): { text: "Hello world " }
//   3. send EOS marker: { text: "" } → server flushes and emits isFinal
//   4. receive { audio: "<base64-pcm>", isFinal?: boolean }
//
// If a new speak() arrives while one is in flight, AbortSignal closes the
// previous WebSocket and the scheduler is reset so we don't double-play.

import { StreamingTTSProvider, base64ToPCM16 } from "./streaming-provider";
import { ApiError, ConfigError } from "../core/errors";

const SAMPLE_RATE = 22_050;
const DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM"; // Rachel
const DEFAULT_MODEL = "eleven_turbo_v2_5";

export class ElevenLabsTTSProvider extends StreamingTTSProvider {
	readonly id = "elevenlabs";

	constructor(
		private apiKey: string,
		private voiceId: string = DEFAULT_VOICE,
		private modelId: string = DEFAULT_MODEL,
	) {
		super(SAMPLE_RATE);
		if (!apiKey) throw new ConfigError("ElevenLabs requires an API key", "Set your ElevenLabs API key in Voice settings before using this agent.");
	}

	protected synthesizeStreaming(
		text: string,
		onChunk: (pcm: Int16Array) => void,
		signal: AbortSignal,
	): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const url =
				`wss://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream-input` +
				`?model_id=${encodeURIComponent(this.modelId)}` +
				`&output_format=pcm_${SAMPLE_RATE}`;
			const ws = new WebSocket(url);
			let finished = false;

			const settle = (fn: () => void): void => {
				if (finished) return;
				finished = true;
				signal.removeEventListener("abort", onAbort);
				fn();
			};
			const onAbort = (): void => {
				try { ws.close(); } catch { /* noop */ }
				settle(() => resolve());
			};
			signal.addEventListener("abort", onAbort);

			ws.onopen = (): void => {
				// First frame must include credentials + voice settings.
				ws.send(
					JSON.stringify({
						text: " ",
						xi_api_key: this.apiKey,
						voice_settings: { stability: 0.5, similarity_boost: 0.75 },
						// `generation_config` is optional — including it makes
						// ElevenLabs flush after each text chunk rather than
						// buffering. Empty chunk_length_schedule = flush ASAP.
						generation_config: { chunk_length_schedule: [50] },
					}),
				);
				// Stream the actual text. We could split on sentence
				// boundaries here for finer-grained streaming; one shot is
				// fine for typical Speak… interactions.
				ws.send(JSON.stringify({ text: text + " " }));
				// EOS — server starts flushing audio after this.
				ws.send(JSON.stringify({ text: "" }));
			};

			ws.onmessage = (event): void => {
				try {
					const msg = JSON.parse(String(event.data));
					if (msg.audio) onChunk(base64ToPCM16(msg.audio));
					if (msg.error) {
						settle(() => reject(new ApiError(0, "ElevenLabs", String(msg.error))));
						try { ws.close(); } catch { /* noop */ }
					}
					if (msg.isFinal) {
						try { ws.close(); } catch { /* noop */ }
					}
				} catch (err) {
					settle(() => reject(err as Error));
				}
			};

			ws.onerror = (): void => {
				settle(() => reject(new ApiError(0, "ElevenLabs", "WebSocket error")));
			};

			ws.onclose = (event): void => {
				if (event.code === 1000 || event.code === 1005) {
					settle(() => resolve());
				} else {
					settle(() =>
						reject(new ApiError(event.code, "ElevenLabs", event.reason || "WebSocket closed")),
					);
				}
			};
		});
	}
}
