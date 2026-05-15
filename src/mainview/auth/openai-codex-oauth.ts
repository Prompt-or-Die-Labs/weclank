// OpenAI Codex OAuth (ChatGPT Plus/Pro PKCE flow).
//
// This is OpenAI's official Codex CLI flow — same `client_id`, same auth
// host, same callback URI. The access_token authenticates against
// `https://chatgpt.com/backend-api` (the ChatGPT backend), NOT
// `api.openai.com`. So it unlocks CHAT/TEXT only — voice (TTS), audio
// transcriptions, and image generation still need an OpenAI platform key
// (see `auth/openai-api.ts`).
//
// Storage layout (all under the user's secrets, keys prefixed `openai_codex_*`):
//   openai_codex_access   — short-lived access_token (~1h)
//   openai_codex_refresh  — long-lived refresh_token
//   openai_codex_expires  — unix-ms timestamp the access token expires at
//   openai_codex_id_token — JWT id_token (carries chatgpt_account_id claim)
//
// `ensureCodexAccessToken()` returns a valid access_token, transparently
// refreshing if the cached one is within 60s of expiry.

import { bunRpc } from "../rpc";
import { setSecretAndPersist, getSecret, hasSecret, deleteSecretAndPersist } from "./secrets-cache";
import { ApiError, ConfigError, AuthError } from "../core/errors";

// Storage keys
export const CODEX_ACCESS = "openai_codex_access";
export const CODEX_REFRESH = "openai_codex_refresh";
export const CODEX_EXPIRES = "openai_codex_expires";
export const CODEX_ID_TOKEN = "openai_codex_id_token";

// OAuth endpoint constants — same client_id as the official Codex CLI so
// the redirect URI registration is honored. The authorize URL + scope live
// in the Bun-side handler (it builds the launch URL); only the token
// endpoint and client_id are used here.
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const REDIRECT_URI = "http://localhost:1455/auth/callback";

// Refresh when within this many ms of expiry to avoid 401-during-flight.
const REFRESH_WINDOW_MS = 60_000;

interface TokenResponse {
	access_token?: string;
	refresh_token?: string;
	id_token?: string;
	expires_in?: number;
	error?: string;
	error_description?: string;
}

export function isCodexConnected(): boolean {
	return hasSecret(CODEX_ACCESS) && hasSecret(CODEX_REFRESH);
}

export async function disconnectCodex(): Promise<void> {
	await Promise.all([
		deleteSecretAndPersist(CODEX_ACCESS),
		deleteSecretAndPersist(CODEX_REFRESH),
		deleteSecretAndPersist(CODEX_EXPIRES),
		deleteSecretAndPersist(CODEX_ID_TOKEN),
	]);
}

/** Run the full OAuth dance and persist tokens. Throws on any failure. */
export async function connectCodexOAuth(): Promise<void> {
	const start = await bunRpc.openAiCodexOAuthStart({});
	if (start.error || !start.authUrl) {
		throw new AuthError(start.error ?? "Failed to start Codex OAuth", start.error ?? "Could not start ChatGPT sign-in.");
	}
	await bunRpc.openUrlInBrowser({ url: start.authUrl });
	const done = await bunRpc.openAiCodexOAuthComplete({});
	if (!done.done || !done.code) {
		throw new AuthError(done.error ?? "Codex OAuth did not complete", done.error ?? "ChatGPT sign-in was canceled or timed out.");
	}
	await exchangeAndStore(done.code, start.codeVerifier);
}

async function exchangeAndStore(code: string, codeVerifier: string): Promise<void> {
	const res = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			client_id: CLIENT_ID,
			code,
			code_verifier: codeVerifier,
			redirect_uri: REDIRECT_URI,
		}),
	});
	if (!res.ok) {
		throw new ApiError(res.status, "OpenAI auth", (await res.text()).slice(0, 200));
	}
	const json = (await res.json()) as TokenResponse;
	if (!json.access_token || !json.refresh_token || typeof json.expires_in !== "number") {
		throw new AuthError(
			`Token response missing fields: ${JSON.stringify(json).slice(0, 200)}`,
			"ChatGPT sign-in returned an unexpected response. Try again.",
		);
	}
	const expiresAt = Date.now() + json.expires_in * 1000;
	await Promise.all([
		setSecretAndPersist(CODEX_ACCESS, json.access_token),
		setSecretAndPersist(CODEX_REFRESH, json.refresh_token),
		setSecretAndPersist(CODEX_EXPIRES, String(expiresAt)),
		json.id_token ? setSecretAndPersist(CODEX_ID_TOKEN, json.id_token) : Promise.resolve(),
	]);
}

/** Return a valid access token, refreshing if the cached one is near expiry.
 * Throws ConfigError if Codex is not connected. */
export async function ensureCodexAccessToken(): Promise<string> {
	if (!isCodexConnected()) {
		throw new ConfigError(
			"Codex OAuth not connected",
			"Connect ChatGPT (Codex) in Settings before using this agent.",
		);
	}
	const expiresAt = Number(getSecret(CODEX_EXPIRES) || 0);
	if (Number.isFinite(expiresAt) && Date.now() < expiresAt - REFRESH_WINDOW_MS) {
		return getSecret(CODEX_ACCESS);
	}
	await refreshAccessToken();
	return getSecret(CODEX_ACCESS);
}

async function refreshAccessToken(): Promise<void> {
	const refresh = getSecret(CODEX_REFRESH);
	if (!refresh) {
		throw new AuthError("No Codex refresh token", "ChatGPT session expired — connect again in Settings.");
	}
	const res = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: refresh,
			client_id: CLIENT_ID,
		}),
	});
	if (!res.ok) {
		throw new ApiError(res.status, "OpenAI auth", (await res.text()).slice(0, 200));
	}
	const json = (await res.json()) as TokenResponse;
	if (!json.access_token || typeof json.expires_in !== "number") {
		throw new AuthError("Refresh response missing fields", "ChatGPT session refresh failed — reconnect in Settings.");
	}
	const expiresAt = Date.now() + json.expires_in * 1000;
	const writes: Array<Promise<void>> = [
		setSecretAndPersist(CODEX_ACCESS, json.access_token),
		setSecretAndPersist(CODEX_EXPIRES, String(expiresAt)),
	];
	// Some refresh responses re-issue the refresh token; persist if present.
	if (json.refresh_token) writes.push(setSecretAndPersist(CODEX_REFRESH, json.refresh_token));
	if (json.id_token) writes.push(setSecretAndPersist(CODEX_ID_TOKEN, json.id_token));
	await Promise.all(writes);
}

/** Decode the chatgpt_account_id claim from a stored id_token. Returns null
 * if no token is stored or the claim is missing. ChatGPT's backend requires
 * this header on most requests. */
export function chatgptAccountId(): string | null {
	const token = getSecret(CODEX_ID_TOKEN);
	if (!token) return null;
	try {
		const parts = token.split(".");
		if (parts.length !== 3) return null;
		const payloadStr = atob(parts[1]!.replace(/-/g, "+").replace(/_/g, "/"));
		const payload = JSON.parse(payloadStr) as Record<string, unknown>;
		const auth = payload["https://api.openai.com/auth"] as Record<string, unknown> | undefined;
		const id = auth?.["chatgpt_account_id"];
		return typeof id === "string" ? id : null;
	} catch {
		return null;
	}
}
