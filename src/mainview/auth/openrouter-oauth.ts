// OpenRouter PKCE OAuth flow — renderer side.
//
// Orchestrates the three-step flow:
//   1. Ask Bun to spin up the callback server + generate the PKCE pair.
//   2. Open the auth URL in the system browser (via `open` / `xdg-open`
//      through Bun.spawn, which works in the Electrobun main process via RPC).
//   3. Wait for Bun to capture the redirect code, then POST to OpenRouter's
//      token endpoint to exchange it for a user API key.
//   4. Persist the key under the canonical key "openrouter".
//
// Returns the acquired key on success, throws on any failure.

import { bunRpc } from "../rpc";
import { setSecretAndPersist } from "./secrets-cache";

export const OPENROUTER_KEY = "openrouter";

export async function connectOpenRouterOAuth(): Promise<string> {
	// Step 1 — Bun starts the callback server and returns the auth URL.
	const start = await bunRpc.openRouterOAuthStart({});
	if (start.error || !start.authUrl) {
		throw new Error(start.error ?? "Failed to start OAuth flow");
	}

	// Step 2 — Open in system browser via Bun (window.open is sandboxed
	// inside WKWebView and will not reach the system browser).
	await bunRpc.openUrlInBrowser({ url: start.authUrl });

	// Step 3 — Block until Bun's callback server captures the code
	// (user completes login in browser) or the 3-minute RPC timeout fires.
	const complete = await bunRpc.openRouterOAuthComplete({});
	if (!complete.done || !complete.code) {
		throw new Error(complete.error ?? "OAuth flow did not complete");
	}

	// Step 4 — Exchange code → API key directly from the renderer
	// (avoids routing credentials through an extra RPC hop).
	const res = await fetch("https://openrouter.ai/api/v1/auth/keys", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			code: complete.code,
			code_verifier: start.codeVerifier,
			code_challenge_method: "S256",
		}),
	});

	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(`OpenRouter key exchange failed (${res.status}): ${body}`);
	}

	const json = await res.json() as { key?: string; error?: string };
	if (!json.key) {
		throw new Error(json.error ?? "OpenRouter did not return a key");
	}

	// Persist under "openrouter" — the TTSProviderId key that
	// getStoredApiKey("openrouter"), llm-client, transcription, and banter
	// all read from secrets-cache.
	await setSecretAndPersist(OPENROUTER_KEY, json.key);

	return json.key;
}
