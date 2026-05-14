// Kick chat connector. Kick's chat is broadcast over Pusher (WebSocket)
// with anonymous subscribe — no auth required to read public channels.
//
// Flow:
//   1. Resolve `chatroom_id` by GETting kick.com/api/v2/channels/{slug}.
//      (Cloudflare-fronted; the request lands from the renderer, which
//       generally satisfies their bot heuristics.)
//   2. Connect to the Pusher endpoint, wait for `pusher:connection_established`.
//   3. Subscribe to channel `chatrooms.{chatroom_id}.v2`.
//   4. For each `ChatMessageEvent`, parse the stringified `data` field and
//      push a ChatMessage onto the queue.
//
// No mod API is available. `supportsModeration()` returns false.

import { MessageQueue, type ChatMessage } from "../banter/chat-source";
import { ApiError } from "../core/errors";
import { reconnectLoop } from "../core/retry";
import type { ChatConnector, ConnectorStatus } from "./chat-connector";

const PUSHER_URL = "wss://ws-us2.pusher.com/app/eb1d5f283081a78b932c?protocol=7&client=js&version=7.6.0&flash=false";

interface KickSender {
	id: number;
	username: string;
	slug: string;
	identity?: {
		color?: string;
		badges?: { type: string; text: string }[];
	};
}

interface KickChatMessageData {
	id: string;
	chatroom_id: number;
	content: string;
	type?: string;
	created_at?: string;
	sender: KickSender;
}

export class KickConnector implements ChatConnector {
	readonly platform = "kick" as const;
	private ws: WebSocket | null = null;
	private queue = new MessageQueue();
	private status: ConnectorStatus;
	private abortController = new AbortController();
	private chatroomId: number | null = null;

	constructor(public readonly channel: string) {
		this.status = { platform: "kick", channel, state: "idle" };
	}

	async connect(): Promise<void> {
		this.status = { ...this.status, state: "connecting" };
		try {
			this.chatroomId = await this.resolveChatroomId();
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.status = { ...this.status, state: "error", error: `Lookup failed: ${message}` };
			throw new ApiError(0, "Kick", `Could not resolve chatroom id for ${this.channel}: ${message}`);
		}
		// First connection is awaited so callers know we're up; the
		// reconnect loop runs in the background after that.
		await new Promise<void>((resolve, reject) => {
			let resolved = false;
			void reconnectLoop(
				() => this.runOneConnection(() => {
					if (!resolved) { resolved = true; resolve(); }
				}),
				{ signal: this.abortController.signal, label: "kick-pusher" },
			);
			setTimeout(() => {
				if (!resolved) {
					resolved = true;
					reject(new ApiError(0, "Kick", "Initial connection failed; retrying in the background"));
				}
			}, 10_000);
		});
		this.status = { ...this.status, state: "connected" };
	}

	disconnect(): void {
		this.abortController.abort();
		try { this.ws?.close(1000); } catch { /* noop */ }
		this.ws = null;
		this.queue.close();
		this.status = { ...this.status, state: "idle" };
	}

	messages(): AsyncIterable<ChatMessage> {
		return this.queue;
	}

	getStatus(): ConnectorStatus {
		return { ...this.status };
	}

	supportsModeration(): boolean {
		return false;
	}

	private async resolveChatroomId(): Promise<number> {
		const url = `https://kick.com/api/v2/channels/${encodeURIComponent(this.channel.toLowerCase())}`;
		const res = await fetch(url, { headers: { Accept: "application/json" } });
		if (!res.ok) {
			throw new ApiError(res.status, "Kick", `Channel lookup HTTP ${res.status}`);
		}
		const body = await res.json() as { chatroom?: { id?: number } };
		const id = body.chatroom?.id;
		if (typeof id !== "number") throw new ApiError(0, "Kick", "Channel missing chatroom.id");
		return id;
	}

	private runOneConnection(onSubscribed: () => void): Promise<void> {
		return new Promise((resolve, reject) => {
			const ws = new WebSocket(PUSHER_URL);
			this.ws = ws;
			const channelName = `chatrooms.${this.chatroomId}.v2`;
			let subscribed = false;

			ws.onopen = (): void => { /* wait for pusher:connection_established */ };
			ws.onerror = (): void => { /* let onclose run for the close code */ };
			ws.onclose = (ev): void => {
				if (ev.code === 1000 || this.abortController.signal.aborted) resolve();
				else reject(new ApiError(ev.code, "Kick", ev.reason || "WebSocket closed unexpectedly"));
			};
			ws.onmessage = (event): void => {
				const frame = parsePusherFrame(String(event.data));
				if (!frame) return;
				switch (frame.event) {
					case "pusher:connection_established":
						ws.send(JSON.stringify({
							event: "pusher:subscribe",
							data: { auth: "", channel: channelName },
						}));
						break;
					case "pusher:subscription_succeeded":
						if (!subscribed) { subscribed = true; onSubscribed(); }
						break;
					case "pusher:ping":
						ws.send(JSON.stringify({ event: "pusher:pong", data: {} }));
						break;
					case "App\\Events\\ChatMessageEvent": {
						const msg = parseKickChatMessage(frame.data);
						if (msg) this.queue.push(msg);
						break;
					}
				}
			};
		});
	}
}

interface PusherFrame {
	event: string;
	channel?: string;
	data?: string;
}

/** Parse a Pusher frame. Both event names and the nested `data` field
 * arrive as strings — Pusher double-encodes for some reason. Exported for
 * testing. */
export function parsePusherFrame(raw: string): PusherFrame | null {
	try {
		const obj = JSON.parse(raw) as { event?: unknown; channel?: unknown; data?: unknown };
		if (typeof obj.event !== "string") return null;
		return {
			event: obj.event,
			channel: typeof obj.channel === "string" ? obj.channel : undefined,
			data: typeof obj.data === "string" ? obj.data : undefined,
		};
	} catch {
		return null;
	}
}

/** Parse the inner stringified ChatMessageEvent body into a ChatMessage.
 * Exported for testing — production code calls this via the WS handler. */
export function parseKickChatMessage(rawData: string | undefined): ChatMessage | null {
	if (!rawData) return null;
	try {
		const parsed = JSON.parse(rawData) as KickChatMessageData;
		if (!parsed.content || !parsed.sender) return null;
		const color = parsed.sender.identity?.color || undefined;
		return {
			author: parsed.sender.username,
			text: parsed.content,
			timestamp: parsed.created_at ? Date.parse(parsed.created_at) || Date.now() : Date.now(),
			platform: "kick",
			messageId: parsed.id,
			authorId: String(parsed.sender.id),
			meta: {
				channel: parsed.sender.slug,
				...(color ? { color } : {}),
			},
		};
	} catch {
		return null;
	}
}
