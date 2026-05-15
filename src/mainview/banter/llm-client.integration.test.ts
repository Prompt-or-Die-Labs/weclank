// Runtime verification of the OpenRouter chat-completions path that
// banter-engine uses for every agent reply. Skipped unless
// OPENROUTER_API_KEY env is set so it doesn't run in CI.
//
// If this passes, an agent driven by an OpenRouter-backed LLM will
// produce text replies when the chat composer sends a message.

import { describe, test, expect } from "bun:test";

const key = process.env["OPENROUTER_API_KEY"];
const skip = !key;

describe.skipIf(skip)("OpenRouter chat-completions — live", () => {
	test("returns a text reply for a simple prompt", async () => {
		const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${key!}`,
				"Content-Type": "application/json",
				"HTTP-Referer": "https://weclank.local",
				"X-Title": "Weclank integration test",
			},
			body: JSON.stringify({
				model: "openrouter/free",
				messages: [
					{ role: "system", content: "You are a terse assistant." },
					{ role: "user", content: "Reply with one short sentence acknowledging you heard me." },
				],
				max_tokens: 60,
			}),
		});
		if (!res.ok) {
			throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
		}
		const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
		const text = j.choices?.[0]?.message?.content?.trim() ?? "";
		expect(text.length).toBeGreaterThan(0);
	}, 60_000);
});
