// Runtime verification of the OpenRouter /v1/audio/transcriptions
// endpoint that mic-transcriber.ts uses for STT. Skipped unless
// OPENROUTER_API_KEY env is set.
//
// We synthesize a tiny silent WAV and hit the endpoint with the exact
// body shape our STT module sends. We don't assert what was transcribed
// (silence + cheap model = empty or "[silence]" — both fine); we assert
// the endpoint accepts the request and returns a parseable response.

import { describe, test, expect } from "bun:test";
import { encodeWav } from "./wav-encoder";

const key = process.env["OPENROUTER_API_KEY"];
const skip = !key;

describe.skipIf(skip)("OpenRouter STT — live", () => {
	test("accepts our request shape; returns a usable transcription response", async () => {
		// 0.5s of silence at 16kHz mono — matches what the mic worklet emits.
		const sampleRate = 16_000;
		const samples = new Float32Array(sampleRate / 2);
		const wav = encodeWav(samples, sampleRate);
		const base64 = arrayBufferToBase64(wav);

		const res = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${key!}`,
				"Content-Type": "application/json",
				"HTTP-Referer": "https://weclank.local",
				"X-Title": "Weclank integration test",
			},
			body: JSON.stringify({
				model: "google/gemini-2.5-flash",
				input_audio: { data: base64, format: "wav" },
			}),
		});
		if (!res.ok) {
			throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
		}
		const j = (await res.json()) as { text?: string };
		// `text` is always present on a successful response — silent input may
		// give an empty string, that's fine; the point is the endpoint accepted
		// our shape and returned a parseable response.
		expect(typeof j.text).toBe("string");
	}, 60_000);
});

function arrayBufferToBase64(buf: ArrayBuffer): string {
	const bytes = new Uint8Array(buf);
	let s = "";
	for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
	return btoa(s);
}
