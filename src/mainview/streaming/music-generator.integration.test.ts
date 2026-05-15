// Runtime verification that ElevenLabs /v1/music accepts our request shape
// and returns audio bytes. Skipped unless EL_API_KEY env is set so it
// doesn't run in CI or for users without a music-tier key.
//
// This mirrors generateMusic() in music-generator.ts exactly — same URL,
// headers, body, output_format. If this test passes against the real API,
// the in-app music generator works end-to-end (modulo URL.createObjectURL
// which is browser-native and trivially correct).

import { describe, test, expect } from "bun:test";

const key = process.env["EL_API_KEY"];
const skip = !key;

describe.skipIf(skip)("ElevenLabs /v1/music — live", () => {
	test("accepts the same body our generator sends; returns audio bytes", async () => {
		const body = {
			prompt: "short ambient tone. Instrumental, no vocals.",
			music_length_ms: 10_000,
			output_format: "mp3_44100_128",
			model_id: "music_v1",
			force_instrumental: true,
		};
		const res = await fetch("https://api.elevenlabs.io/v1/music", {
			method: "POST",
			headers: {
				"xi-api-key": key!,
				"Content-Type": "application/json",
				Accept: "audio/mpeg",
			},
			body: JSON.stringify(body),
		});
		if (!res.ok) {
			const text = await res.text();
			throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
		}
		const bytes = await res.arrayBuffer();
		expect(bytes.byteLength).toBeGreaterThan(1000); // any real mp3 > 1KB
		const view = new Uint8Array(bytes);
		// MP3 frame sync (0xFFE…) or ID3 tag.
		const isMp3 = view[0] === 0x49 || (view[0] === 0xFF && (view[1]! & 0xE0) === 0xE0);
		expect(isMp3).toBe(true);
	}, 120_000);
});
