// Twitch ChatConnector — wraps the existing anonymous-IRC TwitchChatSource
// with platform identity. Moderation is opt-in: if a Twitch OAuth token
// with `channel:moderate` is present in secrets, this connector connects
// over an *authenticated* IRC session and can issue chat commands. Without
// the token it stays anonymous-read-only.

import { TwitchChatSource } from "../banter/twitch-chat";
import { MessageQueue, type ChatMessage } from "../banter/chat-source";
import { getSecret } from "../auth/secrets-cache";
import { ApiError } from "../core/errors";
import type { ChatConnector, ConnectorStatus, ModerateAction } from "./chat-connector";

export const TWITCH_OAUTH_KEY = "twitch_oauth_token";

export class TwitchConnector implements ChatConnector {
	readonly platform = "twitch" as const;
	private inner: TwitchChatSource;
	private queue = new MessageQueue();
	private status: ConnectorStatus;
	private modSocket: WebSocket | null = null;
	private modReady: Promise<void> | null = null;

	constructor(public readonly channel: string) {
		this.inner = new TwitchChatSource(channel);
		this.status = { platform: "twitch", channel, state: "idle" };
	}

	async connect(): Promise<void> {
		this.status = { ...this.status, state: "connecting" };
		try {
			await this.inner.connect();
			this.status = { ...this.status, state: "connected" };
			void this.pumpMessages();
			// Open the mod socket lazily — only if an OAuth token exists.
			if (this.supportsModeration()) this.modReady = this.openModSocket();
		} catch (err) {
			this.status = {
				...this.status,
				state: "error",
				error: err instanceof Error ? err.message : String(err),
			};
			throw err;
		}
	}

	disconnect(): void {
		this.inner.disconnect();
		try { this.modSocket?.close(1000); } catch { /* noop */ }
		this.modSocket = null;
		this.modReady = null;
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
		return !!getSecret(TWITCH_OAUTH_KEY);
	}

	async moderate(action: ModerateAction): Promise<void> {
		// Twitch chat commands ride over the same IRC connection. We open
		// a separate authenticated socket on first use so the anonymous
		// read socket isn't disrupted. Channel mod commands ("/delete",
		// "/timeout", "/ban") are deprecated for new apps but still work
		// over IRC; the modern path is the Helix API. Keep IRC for now
		// since it doesn't need user-id resolution; switch to Helix when
		// the OAuth flow gets implemented.
		if (!this.modReady) {
			if (!this.supportsModeration()) {
				throw new ApiError(0, "Twitch", "Twitch moderation requires an OAuth token (none saved)");
			}
			this.modReady = this.openModSocket();
		}
		await this.modReady;
		const cmd = formatModCommand(action);
		this.modSocket?.send(`PRIVMSG #${this.channel.toLowerCase()} :${cmd}`);
	}

	private async pumpMessages(): Promise<void> {
		for await (const raw of this.inner.messages()) {
			// The existing TwitchChatSource stuffs `channel` into meta but
			// doesn't tag platform / surface tags.id. Re-stamp here.
			this.queue.push({
				...raw,
				platform: "twitch",
				messageId: raw.meta?.["msgId"] ?? raw.meta?.["id"] ?? undefined,
				authorId: raw.meta?.["userId"] ?? undefined,
			});
		}
	}

	private openModSocket(): Promise<void> {
		return new Promise((resolve, reject) => {
			const ws = new WebSocket("wss://irc-ws.chat.twitch.tv:443");
			this.modSocket = ws;
			const token = getSecret(TWITCH_OAUTH_KEY);
			ws.onopen = (): void => {
				ws.send("CAP REQ :twitch.tv/commands");
				ws.send(`PASS oauth:${token}`);
				ws.send(`NICK ${this.channel.toLowerCase()}`);
				ws.send(`JOIN #${this.channel.toLowerCase()}`);
				resolve();
			};
			ws.onerror = (): void => reject(new ApiError(0, "Twitch", "Mod socket failed"));
			ws.onclose = (): void => { this.modSocket = null; };
		});
	}
}

function formatModCommand(action: ModerateAction): string {
	switch (action.kind) {
		case "delete":  return `/delete ${action.messageId}`;
		case "timeout": return `/timeout ${action.userId} ${action.durationSec}${action.reason ? ` ${action.reason}` : ""}`;
		case "ban":     return `/ban ${action.userId}${action.reason ? ` ${action.reason}` : ""}`;
	}
}
