// Real-WebSocket end-to-end test. Boots the server on a random port,
// connects via Bun's WebSocket client, walks the Hello → Identify →
// Identified handshake, runs a request, and tears down cleanly.

import { afterEach, describe, expect, test } from "bun:test";
import { EventSubscription, OpCode } from "./protocol";
import { computeAuthString, type AuthSession } from "./auth";
import type { StudioAdapter } from "./handlers";
import { startObsWebSocketServer, type ServerHandle } from "./server";

let activeServer: ServerHandle | null = null;
afterEach(async () => {
	if (activeServer) {
		await activeServer.stop();
		activeServer = null;
	}
});

function fakeStudio(overrides: Partial<StudioAdapter> = {}): StudioAdapter {
	return {
		getScenes: () => [{ sceneName: "Main", sceneIndex: 0 }],
		getCurrentSceneName: () => "Main",
		setCurrentSceneName: () => true,
		isStreamLive: () => false,
		isRecording: () => false,
		startStream: async () => true,
		stopStream: async () => true,
		startRecord: async () => true,
		stopRecord: async () => true,
		getRecordTimecode: () => "00:00:00.000",
		getStreamTimecode: () => "00:00:00.000",
		...overrides,
	};
}

function pickPort(): number {
	return 14000 + Math.floor(Math.random() * 1000);
}

interface Collected {
	frames: Array<{ op: number; d: Record<string, unknown> }>;
	closed: { code: number; reason: string } | null;
}

function connect(port: number): Promise<{ ws: WebSocket; collected: Collected }> {
	return new Promise((resolve, reject) => {
		const collected: Collected = { frames: [], closed: null };
		const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
		ws.addEventListener("message", (e) => {
			collected.frames.push(JSON.parse(typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data as ArrayBuffer)));
		});
		ws.addEventListener("close", (e) => {
			collected.closed = { code: e.code, reason: e.reason };
		});
		ws.addEventListener("error", (e) => reject(e));
		ws.addEventListener("open", () => resolve({ ws, collected }));
	});
}

async function waitFor<T>(check: () => T | undefined | null, timeoutMs = 1500): Promise<NonNullable<T>> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const r = check();
		if (r !== undefined && r !== null) return r as NonNullable<T>;
		await new Promise((r) => setTimeout(r, 10));
	}
	throw new Error("waitFor timed out");
}

describe("obs-websocket server — end-to-end", () => {
	test("Hello → Identify (no auth) → Identified, then GetVersion responds", async () => {
		const port = pickPort();
		activeServer = startObsWebSocketServer({ port, studio: fakeStudio() });

		const { ws, collected } = await connect(port);
		const hello = await waitFor(() => collected.frames.find((f) => f.op === OpCode.Hello));
		expect((hello.d as { obsWebSocketVersion: string }).obsWebSocketVersion).toBe("5.5.0");

		ws.send(JSON.stringify({
			op: OpCode.Identify,
			d: { rpcVersion: 1, eventSubscriptions: EventSubscription.All },
		}));

		const identified = await waitFor(() => collected.frames.find((f) => f.op === OpCode.Identified));
		expect((identified.d as { negotiatedRpcVersion: number }).negotiatedRpcVersion).toBe(1);

		ws.send(JSON.stringify({
			op: OpCode.Request,
			d: { requestType: "GetVersion", requestId: "req-1" },
		}));

		const response = await waitFor(() =>
			collected.frames.find((f) => f.op === OpCode.RequestResponse),
		);
		const r = response.d as {
			requestStatus: { result: boolean };
			responseData?: { rpcVersion: number; obsWebSocketVersion: string };
		};
		expect(r.requestStatus.result).toBe(true);
		expect(r.responseData?.rpcVersion).toBe(1);

		ws.close();
	}, 5_000);

	test("auth required: client must compute SHA-256 challenge correctly", async () => {
		const port = pickPort();
		const password = "test-password-123";
		activeServer = startObsWebSocketServer({ port, password, studio: fakeStudio() });

		const { ws, collected } = await connect(port);
		const hello = await waitFor(() => collected.frames.find((f) => f.op === OpCode.Hello));
		const helloD = hello.d as {
			authentication?: { challenge: string; salt: string };
		};
		expect(helloD.authentication).toBeDefined();
		expect(helloD.authentication?.challenge.length).toBeGreaterThan(0);
		expect(helloD.authentication?.salt.length).toBeGreaterThan(0);

		const session: AuthSession = {
			challenge: helloD.authentication!.challenge,
			salt: helloD.authentication!.salt,
		};
		const auth = computeAuthString(password, session);

		ws.send(JSON.stringify({
			op: OpCode.Identify,
			d: { rpcVersion: 1, authentication: auth },
		}));

		const identified = await waitFor(() => collected.frames.find((f) => f.op === OpCode.Identified));
		expect(identified).toBeDefined();
		ws.close();
	}, 5_000);

	test("auth required: wrong password closes with 4009", async () => {
		const port = pickPort();
		activeServer = startObsWebSocketServer({ port, password: "right-pw", studio: fakeStudio() });

		const { ws, collected } = await connect(port);
		const hello = await waitFor(() => collected.frames.find((f) => f.op === OpCode.Hello));
		const helloD = hello.d as { authentication: { challenge: string; salt: string } };
		const auth = computeAuthString("WRONG-pw", helloD.authentication);

		ws.send(JSON.stringify({
			op: OpCode.Identify,
			d: { rpcVersion: 1, authentication: auth },
		}));

		const closed = await waitFor(() => collected.closed);
		expect(closed.code).toBe(4009); // AuthenticationFailed
	}, 5_000);

	test("Request before Identify closes with 4007 NotIdentified", async () => {
		const port = pickPort();
		activeServer = startObsWebSocketServer({ port, studio: fakeStudio() });

		const { ws, collected } = await connect(port);
		await waitFor(() => collected.frames.find((f) => f.op === OpCode.Hello));

		ws.send(JSON.stringify({
			op: OpCode.Request,
			d: { requestType: "GetVersion", requestId: "x" },
		}));

		const closed = await waitFor(() => collected.closed);
		expect(closed.code).toBe(4007);
	}, 5_000);

	test("identifiedClientCount tracks identified-but-not-yet-closed clients", async () => {
		const port = pickPort();
		activeServer = startObsWebSocketServer({ port, studio: fakeStudio() });
		expect(activeServer.identifiedClientCount()).toBe(0);

		// Open a socket but don't Identify — still 0.
		const { ws: ws1, collected: c1 } = await connect(port);
		await waitFor(() => c1.frames.find((f) => f.op === OpCode.Hello));
		expect(activeServer.identifiedClientCount()).toBe(0);

		// Identify — count goes to 1.
		ws1.send(JSON.stringify({ op: OpCode.Identify, d: { rpcVersion: 1 } }));
		await waitFor(() => c1.frames.find((f) => f.op === OpCode.Identified));
		expect(activeServer.identifiedClientCount()).toBe(1);

		// Second identified client — 2.
		const { ws: ws2, collected: c2 } = await connect(port);
		await waitFor(() => c2.frames.find((f) => f.op === OpCode.Hello));
		ws2.send(JSON.stringify({ op: OpCode.Identify, d: { rpcVersion: 1 } }));
		await waitFor(() => c2.frames.find((f) => f.op === OpCode.Identified));
		expect(activeServer.identifiedClientCount()).toBe(2);

		// Close ws1 — count drops to 1. (Bun's close event is async;
		// give it a tick to propagate.)
		ws1.close();
		await new Promise((r) => setTimeout(r, 200));
		expect(activeServer.identifiedClientCount()).toBe(1);

		ws2.close();
	}, 10_000);

	test("emit() pushes events only to subscribed sessions", async () => {
		const port = pickPort();
		activeServer = startObsWebSocketServer({ port, studio: fakeStudio() });

		const { ws, collected } = await connect(port);
		await waitFor(() => collected.frames.find((f) => f.op === OpCode.Hello));

		// Subscribe to only General (bit 0). Scenes events (bit 2) shouldn't reach us.
		ws.send(JSON.stringify({
			op: OpCode.Identify,
			d: { rpcVersion: 1, eventSubscriptions: EventSubscription.General },
		}));
		await waitFor(() => collected.frames.find((f) => f.op === OpCode.Identified));

		// Emit something to Scenes (bit 2) — should NOT arrive.
		activeServer.emit(EventSubscription.Scenes, "CurrentProgramSceneChanged", { sceneName: "Two" });
		// Emit something to General (bit 0) — should arrive.
		activeServer.emit(EventSubscription.General, "ExitStarted");

		// Give events a tick to flush.
		await new Promise((r) => setTimeout(r, 100));
		const events = collected.frames.filter((f) => f.op === OpCode.Event);
		expect(events).toHaveLength(1);
		expect((events[0]!.d as { eventType: string }).eventType).toBe("ExitStarted");

		ws.close();
	}, 5_000);
});
