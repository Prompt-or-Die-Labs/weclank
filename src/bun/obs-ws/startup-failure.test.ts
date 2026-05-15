// Verifies the failure-visibility path that the advisor specifically
// called out: if obs-ws is `enabled: true` in persisted config but the
// configured port is already in use, the startup must throw cleanly so
// the apply-state machine can capture it in `lastStartupError`.
//
// Without this test, a stale config could ship a "silently broken
// obs-ws" — Stream Deck would fail to connect, with no signal to the
// user that the toggle is on but the server isn't listening.

import { afterEach, describe, expect, test } from "bun:test";
import { startObsWebSocketServer, type ServerHandle } from "./server";
import { createBridgeStudioAdapter } from "./studio-bridge";

const handles: ServerHandle[] = [];

afterEach(async () => {
	while (handles.length > 0) {
		try { await handles.shift()!.stop(); } catch { /* noop */ }
	}
});

function pickPort(): number {
	return 16000 + Math.floor(Math.random() * 1000);
}

describe("obs-ws server startup — port-in-use failure", () => {
	test("second server on the same port throws synchronously", async () => {
		const port = pickPort();
		const first = startObsWebSocketServer({ port, studio: createBridgeStudioAdapter() });
		handles.push(first);

		// Bun.serve() throws synchronously when it can't bind. Our
		// startObsWebSocketServer() lets that propagate so the caller
		// (applyObsWsServerState) can catch + record.
		expect(() => {
			const second = startObsWebSocketServer({ port, studio: createBridgeStudioAdapter() });
			handles.push(second);
		}).toThrow();
	});

	test("startup-failure recovery: first server keeps listening after a failed second start", async () => {
		const port = pickPort();
		const first = startObsWebSocketServer({ port, studio: createBridgeStudioAdapter() });
		handles.push(first);

		// Attempted collision — must fail.
		try {
			const second = startObsWebSocketServer({ port, studio: createBridgeStudioAdapter() });
			handles.push(second);
		} catch { /* expected */ }

		// First server should still be functional — verify by connecting.
		const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
		const helloReceived = await new Promise<boolean>((resolve) => {
			const timer = setTimeout(() => resolve(false), 1500);
			ws.addEventListener("message", (e) => {
				const f = JSON.parse(typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data as ArrayBuffer));
				if (f.op === 0 /* Hello */) {
					clearTimeout(timer);
					resolve(true);
				}
			});
			ws.addEventListener("error", () => { clearTimeout(timer); resolve(false); });
		});
		ws.close();
		expect(helloReceived).toBe(true);
	});
});
