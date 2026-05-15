// obs-websocket v5 server. Hosts a WebSocket on 127.0.0.1 by default
// (LAN exposure is opt-in) and bridges Stream Deck / Companion / Touch
// Portal control surfaces to the studio state.
//
// Architecture: `Bun.serve({websocket: ...})` with one session object
// per connection. The session tracks auth + subscription state.
// Handlers don't know about Bun; they take a `StudioAdapter` interface.
//
// Auth: SHA-256 challenge per the obs-websocket spec — see ./auth.ts.
// Password lives in `studio.db` (user_secrets) so it survives restarts.

import {
	encodeFrame,
	parseFrame,
	OpCode,
	RPC_VERSION,
	EventSubscription,
	CloseCode,
	RequestStatusCode,
	type Frame,
} from "./protocol";
import { newAuthSession, verifyAuth, type AuthSession } from "./auth";
import { HANDLERS, type StudioAdapter, OBS_WS_VERSION } from "./handlers";

export interface ServerOptions {
	hostname?: string;
	port?: number;
	password?: string; // required for clients to Identify
	studio: StudioAdapter;
}

interface Session {
	identified: boolean;
	subscriptions: number;
	auth: AuthSession | null;
}

export interface ServerHandle {
	port: number;
	stop(): Promise<void>;
	/** Emit an event to all subscribed sessions. The event won't fire
	 *  for sessions whose subscription bitmask doesn't include
	 *  `intent`. */
	emit(intent: number, eventType: string, eventData?: Record<string, unknown>): void;
	/** Number of identified clients currently connected. The renderer
	 *  uses this to back off its command-poll cadence when nobody's
	 *  listening — 4 RPC/sec idle traffic is real waste. */
	identifiedClientCount(): number;
}

export function startObsWebSocketServer(opts: ServerOptions): ServerHandle {
	const sessions = new Map<unknown, Session>();
	const sockets = new Set<{ send(s: string): number; close(code?: number): void }>();
	const passwordRequired = Boolean(opts.password && opts.password.length > 0);

	const server = Bun.serve({
		hostname: opts.hostname ?? "127.0.0.1",
		port: opts.port ?? 4455,
		fetch(req, server) {
			const url = new URL(req.url);
			if (url.pathname === "/") {
				if (server.upgrade(req)) return;
				return new Response("obs-websocket v5 endpoint", { status: 200 });
			}
			return new Response("Not Found", { status: 404 });
		},
		websocket: {
			open(ws) {
				const auth = passwordRequired ? newAuthSession() : null;
				const session: Session = {
					identified: false,
					subscriptions: EventSubscription.None,
					auth,
				};
				sessions.set(ws, session);
				sockets.add(ws as unknown as { send(s: string): number; close(code?: number): void });
				const hello: Frame = {
					op: OpCode.Hello,
					d: {
						obsWebSocketVersion: OBS_WS_VERSION,
						rpcVersion: RPC_VERSION,
						...(auth ? { authentication: { challenge: auth.challenge, salt: auth.salt } } : {}),
					},
				};
				ws.send(encodeFrame(hello));
			},
			message(ws, message) {
				const session = sessions.get(ws);
				if (!session) return;
				const raw = typeof message === "string" ? message : new TextDecoder().decode(message);
				const parsed = parseFrame(raw);
				if ("error" in parsed) {
					ws.close(parsed.error);
					return;
				}
				handleFrame(ws, session, parsed, opts).catch((err) => {
					console.error("[obs-ws] handler error:", err);
				});
			},
			close(ws) {
				sessions.delete(ws);
				sockets.delete(ws as unknown as { send(s: string): number; close(code?: number): void });
			},
		},
	});

	const handle: ServerHandle = {
		port: server.port ?? (opts.port ?? 4455),
		async stop(): Promise<void> {
			for (const ws of sockets) {
				try { ws.close(CloseCode.SessionInvalidated); } catch { /* noop */ }
			}
			sessions.clear();
			sockets.clear();
			server.stop(true);
		},
		emit(intent, eventType, eventData) {
			const frame: Frame = {
				op: OpCode.Event,
				d: { eventType, eventIntent: intent, eventData },
			};
			const wire = encodeFrame(frame);
			for (const [ws, session] of sessions) {
				if (!session.identified) continue;
				if ((session.subscriptions & intent) === 0) continue;
				try {
					(ws as unknown as { send(s: string): number }).send(wire);
				} catch { /* socket may be dead */ }
			}
		},
		identifiedClientCount(): number {
			let count = 0;
			for (const s of sessions.values()) {
				if (s.identified) count++;
			}
			return count;
		},
	};

	return handle;
}

async function handleFrame(
	ws: unknown,
	session: Session,
	frame: Frame,
	opts: ServerOptions,
): Promise<void> {
	const send = (f: Frame): void => {
		try { (ws as { send(s: string): number }).send(encodeFrame(f)); } catch { /* noop */ }
	};
	const close = (code: number): void => {
		try { (ws as { close(c: number): void }).close(code); } catch { /* noop */ }
	};

	switch (frame.op) {
		case OpCode.Identify: {
			if (session.identified) {
				close(CloseCode.AlreadyIdentified);
				return;
			}
			if (frame.d.rpcVersion !== RPC_VERSION) {
				close(CloseCode.UnsupportedRpcVersion);
				return;
			}
			if (session.auth) {
				if (!frame.d.authentication) {
					close(CloseCode.AuthenticationFailed);
					return;
				}
				if (!verifyAuth(frame.d.authentication, opts.password ?? "", session.auth)) {
					close(CloseCode.AuthenticationFailed);
					return;
				}
			}
			session.identified = true;
			session.subscriptions = frame.d.eventSubscriptions ?? EventSubscription.All;
			send({
				op: OpCode.Identified,
				d: { negotiatedRpcVersion: RPC_VERSION },
			});
			return;
		}
		case OpCode.Reidentify: {
			if (!session.identified) {
				close(CloseCode.NotIdentified);
				return;
			}
			session.subscriptions = frame.d.eventSubscriptions ?? session.subscriptions;
			return;
		}
		case OpCode.Request: {
			if (!session.identified) {
				close(CloseCode.NotIdentified);
				return;
			}
			const handler = HANDLERS[frame.d.requestType];
			if (!handler) {
				send({
					op: OpCode.RequestResponse,
					d: {
						requestType: frame.d.requestType,
						requestId: frame.d.requestId,
						requestStatus: {
							result: false,
							code: RequestStatusCode.UnknownRequestType,
							comment: `Unknown request type "${frame.d.requestType}"`,
						},
					},
				});
				return;
			}
			try {
				const result = await handler(frame.d.requestData ?? {}, opts.studio);
				send({
					op: OpCode.RequestResponse,
					d: {
						requestType: frame.d.requestType,
						requestId: frame.d.requestId,
						requestStatus: result.ok
							? { result: true, code: RequestStatusCode.Success }
							: {
								result: false,
								code: RequestStatusCode.RequestProcessingFailed,
								comment: result.comment,
							},
						...(result.data ? { responseData: result.data } : {}),
					},
				});
			} catch (err) {
				send({
					op: OpCode.RequestResponse,
					d: {
						requestType: frame.d.requestType,
						requestId: frame.d.requestId,
						requestStatus: {
							result: false,
							code: RequestStatusCode.GenericError,
							comment: err instanceof Error ? err.message : String(err),
						},
					},
				});
			}
			return;
		}
		default:
			// Server-direction frames (Hello, Identified, Event, Response,
			// BatchResponse) shouldn't arrive from the client. Ignore.
			return;
	}
}
