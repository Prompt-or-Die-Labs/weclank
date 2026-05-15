// Verifies Codex OAuth token caching + refresh behavior + id_token claim
// extraction. Uses mock.module to swap the secrets-cache module at
// import time (ES module exports are read-only at runtime).

import { describe, expect, mock, test } from "bun:test";

let cacheMap: Record<string, string> = {};
const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];

mock.module("./secrets-cache", () => ({
	getSecret: (k: string) => cacheMap[k] ?? "",
	hasSecret: (k: string) => Boolean(cacheMap[k]),
	setSecretAndPersist: async (k: string, v: string) => {
		cacheMap[k] = v;
	},
	deleteSecretAndPersist: async (k: string) => {
		delete cacheMap[k];
	},
}));

// Import after the module mock so the codex-oauth module picks up our stub.
const {
	CODEX_ACCESS,
	CODEX_EXPIRES,
	CODEX_ID_TOKEN,
	CODEX_REFRESH,
	chatgptAccountId,
	ensureCodexAccessToken,
	isCodexConnected,
} = await import("./openai-codex-oauth");

function reset(seed: Record<string, string> = {}): void {
	cacheMap = { ...seed };
	fetchCalls.length = 0;
}

function installFetch(response: Response): typeof fetch {
	const previous = globalThis.fetch;
	const stub = mock(async (url: string | URL | Request, init?: RequestInit) => {
		fetchCalls.push({ url: String(url), init });
		return response.clone();
	});
	globalThis.fetch = stub as unknown as typeof fetch;
	return previous;
}

describe("openai-codex-oauth", () => {
	test("isCodexConnected reflects presence of both tokens", () => {
		reset();
		expect(isCodexConnected()).toBe(false);
		cacheMap[CODEX_ACCESS] = "AT";
		expect(isCodexConnected()).toBe(false);
		cacheMap[CODEX_REFRESH] = "RT";
		expect(isCodexConnected()).toBe(true);
	});

	test("ensureCodexAccessToken returns cached token when not near expiry", async () => {
		reset({
			[CODEX_ACCESS]: "fresh",
			[CODEX_REFRESH]: "rt",
			[CODEX_EXPIRES]: String(Date.now() + 5 * 60 * 1000),
		});
		const previous = installFetch(new Response("{}", { status: 200 }));
		try {
			expect(await ensureCodexAccessToken()).toBe("fresh");
			expect(fetchCalls.length).toBe(0);
		} finally {
			globalThis.fetch = previous;
		}
	});

	test("ensureCodexAccessToken refreshes when within the refresh window", async () => {
		reset({
			[CODEX_ACCESS]: "stale",
			[CODEX_REFRESH]: "rt",
			[CODEX_EXPIRES]: String(Date.now() + 10_000),
		});
		const previous = installFetch(
			new Response(
				JSON.stringify({ access_token: "new", refresh_token: "rt2", expires_in: 3600 }),
				{ status: 200 },
			),
		);
		try {
			expect(await ensureCodexAccessToken()).toBe("new");
			expect(fetchCalls.length).toBe(1);
			expect(fetchCalls[0]?.url).toBe("https://auth.openai.com/oauth/token");
			expect(cacheMap[CODEX_ACCESS]).toBe("new");
			expect(cacheMap[CODEX_REFRESH]).toBe("rt2");
		} finally {
			globalThis.fetch = previous;
		}
	});

	test("ensureCodexAccessToken throws if not connected", async () => {
		reset();
		await expect(ensureCodexAccessToken()).rejects.toThrow(/not connected/i);
	});

	test("chatgptAccountId decodes the claim from id_token", () => {
		const payload = { "https://api.openai.com/auth": { chatgpt_account_id: "acct-123" } };
		const jwt = ["hdr", btoa(JSON.stringify(payload)), "sig"].join(".");
		reset({ [CODEX_ID_TOKEN]: jwt });
		expect(chatgptAccountId()).toBe("acct-123");
	});

	test("chatgptAccountId returns null for a malformed token", () => {
		reset({ [CODEX_ID_TOKEN]: "not-a-jwt" });
		expect(chatgptAccountId()).toBeNull();
	});
});
