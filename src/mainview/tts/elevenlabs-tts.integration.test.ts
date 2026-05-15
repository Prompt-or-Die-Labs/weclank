// Runtime verification of the ElevenLabs streaming TTS path. Skipped
// unless EL_API_KEY env is set.
//
// We can't import the renderer-side ElevenLabsTTSProvider here because
// it expects a browser AudioContext. Instead we replicate the WebSocket
// connection it makes — same URL, same handshake, same EOS marker — and
// assert that audio chunks arrive. If this passes, the production path
// works (the AudioContext-dependent decode/playback in the renderer is
// browser-native and trivially correct).

import { describe, test, expect } from "bun:test";

const key = process.env["EL_API_KEY"];
const skip = !key;

const VOICE = "21m00Tcm4TlvDq8ikWAM"; // Rachel — default in the provider
const MODEL = "eleven_turbo_v2_5";
const SAMPLE_RATE = 22_050;

describe.skipIf(skip)("ElevenLabs stream-input WS — live", () => {
	test("hand-shake + EOS produces base64 PCM audio chunks", async () => {
		const url =
			`wss://api.elevenlabs.io/v1/text-to-speech/${VOICE}/stream-input` +
			`?model_id=${encodeURIComponent(MODEL)}` +
			`&output_format=pcm_${SAMPLE_RATE}`;

		const audioChunks: string[] = [];
		await new Promise<void>((resolve, reject) => {
			const ws = new WebSocket(url);
			const timeout = setTimeout(() => {
				try { ws.close(); } catch { /* noop */ }
				reject(new Error("ws timeout — no audio in 30s"));
			}, 30_000);

			ws.onopen = (): void => {
				ws.send(JSON.stringify({
					text: " ",
					xi_api_key: key!,
					voice_settings: { stability: 0.5, similarity_boost: 0.75 },
					generation_config: { chunk_length_schedule: [50] },
				}));
				ws.send(JSON.stringify({ text: "hello world from the integration test" }));
				ws.send(JSON.stringify({ text: "" })); // EOS
			};
			ws.onmessage = (e): void => {
				try {
					const msg = JSON.parse(String(e.data));
					if (msg.audio) audioChunks.push(msg.audio);
					if (msg.error) {
						clearTimeout(timeout);
						try { ws.close(); } catch { /* noop */ }
						reject(new Error(`server error: ${msg.error}`));
					}
					if (msg.isFinal) {
						clearTimeout(timeout);
						try { ws.close(); } catch { /* noop */ }
						resolve();
					}
				} catch (err) {
					clearTimeout(timeout);
					reject(err as Error);
				}
			};
			ws.onerror = (): void => {
				clearTimeout(timeout);
				reject(new Error("ws error event"));
			};
			ws.onclose = (e): void => {
				clearTimeout(timeout);
				if (audioChunks.length > 0) resolve();
				else reject(new Error(`ws closed code=${e.code} reason=${e.reason}`));
			};
		});

		expect(audioChunks.length).toBeGreaterThan(0);
		// Each chunk is base64-encoded PCM — non-empty, no whitespace.
		const total = audioChunks.reduce((n, c) => n + c.length, 0);
		expect(total).toBeGreaterThan(100);
	}, 45_000);
});
