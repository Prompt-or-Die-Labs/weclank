// Twitch chat source. Connects to Twitch's IRC-over-WebSocket gateway as
// an anonymous "justinfan" reader — no OAuth, no tokens, works for any
// public channel. We just need to receive PRIVMSGs.
//
// Parses a minimal subset of IRCv3:
//   PING → reply with PONG
//   PRIVMSG #channel :message → emit ChatMessage with display-name from tags

import { MessageQueue, type ChatMessage, type ChatSource } from "./chat-source";
import { ConfigError, ApiError } from "../core/errors";
import { reconnectLoop } from "../core/retry";

const WS_URL = "wss://irc-ws.chat.twitch.tv:443";

export class TwitchChatSource implements ChatSource {
	private ws: WebSocket | null = null;
	private queue = new MessageQueue();
	private abortController = new AbortController();

	constructor(private channel: string) {
		if (!channel) throw new ConfigError("Twitch channel required", "Set a Twitch channel in Banter settings to connect to chat.");
	}

	connect(): Promise<void> {
		// Wait for the first connection so callers know we're up, then
		// kick off the reconnect loop in the background. The loop survives
		// network blips and Twitch's periodic kicks.
		return new Promise((resolve, reject) => {
			let resolved = false;
			void reconnectLoop(
				() => this.runOneConnection(() => {
					if (!resolved) { resolved = true; resolve(); }
				}),
				{ signal: this.abortController.signal, label: "twitch-irc" },
			);
			// If the first attempt fails with an unrecoverable error, surface
			// it to the initial connect() call so the banter session can
			// log+continue.
			setTimeout(() => {
				if (!resolved) {
					resolved = true;
					reject(new ApiError(0, "Twitch IRC", "Initial connection failed; will keep retrying in the background"));
				}
			}, 10_000);
		});
	}

	private runOneConnection(onOpen: () => void): Promise<void> {
		return new Promise((resolve, reject) => {
			const ws = new WebSocket(WS_URL);
			this.ws = ws;
			const nick = `justinfan${Math.floor(Math.random() * 1_000_000)}`;

			ws.onopen = (): void => {
				ws.send("CAP REQ :twitch.tv/tags twitch.tv/commands");
				ws.send(`NICK ${nick}`);
				ws.send(`JOIN #${this.channel.toLowerCase()}`);
				onOpen();
			};
			ws.onerror = (): void => {
				// Don't reject here — let onclose run so we see the close
				// code. Logged for debugging.
			};
			ws.onclose = (ev): void => {
				if (ev.code === 1000 || this.abortController.signal.aborted) resolve();
				else reject(new ApiError(ev.code, "Twitch IRC", ev.reason || "WebSocket closed unexpectedly"));
			};
			ws.onmessage = (event): void => this.handleFrame(String(event.data));
		});
	}

	disconnect(): void {
		this.abortController.abort();
		try { this.ws?.close(1000); } catch { /* noop */ }
		this.ws = null;
		this.queue.close();
	}

	messages(): AsyncIterable<ChatMessage> {
		return this.queue;
	}

	private handleFrame(raw: string): void {
		for (const line of raw.split("\r\n")) {
			if (!line) continue;
			if (line.startsWith("PING")) {
				this.ws?.send("PONG :tmi.twitch.tv");
				continue;
			}
			const msg = parsePrivmsg(line);
			if (msg) this.queue.push(msg);
		}
	}
}

/** Parse a single IRC line into a ChatMessage. Exported for testing —
 * production code only consumes via the WebSocket message handler. */
export function parsePrivmsg(line: string): ChatMessage | null {
	// Frame shape: "@tag1=val;tag2=val :nick!user@host PRIVMSG #channel :message text"
	// Tags are optional but we requested them, so they're usually present.
	let tags: Record<string, string> = {};
	let rest = line;
	if (rest.startsWith("@")) {
		const space = rest.indexOf(" ");
		if (space < 0) return null;
		tags = parseTags(rest.slice(1, space));
		rest = rest.slice(space + 1);
	}
	const privmsgIdx = rest.indexOf(" PRIVMSG ");
	if (privmsgIdx < 0) return null;
	const after = rest.slice(privmsgIdx + " PRIVMSG ".length);
	const textIdx = after.indexOf(" :");
	if (textIdx < 0) return null;
	const channel = after.slice(0, textIdx);
	const text = after.slice(textIdx + 2);

	const nickMatch = rest.match(/^:([^!]+)!/);
	const author = tags["display-name"] || nickMatch?.[1] || "anon";
	return {
		author,
		text,
		timestamp: Date.now(),
		meta: { channel },
	};
}

function parseTags(raw: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const pair of raw.split(";")) {
		const eq = pair.indexOf("=");
		if (eq < 0) continue;
		out[pair.slice(0, eq)] = pair.slice(eq + 1);
	}
	return out;
}
