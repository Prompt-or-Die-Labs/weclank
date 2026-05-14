// YouTube Live chat connector. Reading YouTube Live chat requires the
// YouTube Data API v3 `liveChatMessages` endpoint, which:
//   - Needs a Google OAuth2 token with `youtube.readonly` scope (or
//     `youtube.force-ssl` for delete actions).
//   - Costs 5 quota units per poll; default daily quota is 10,000 units,
//     so polling cadence has to be moderate (≥10s) to last a full stream.
//
// This file is the *placeholder* connector — it satisfies the ChatConnector
// interface but fails connect() with a clear "OAuth required" message
// until the OAuth flow lands. ChatBus surfaces the error to the UI so a
// missing OAuth doesn't take down the rest of the chat feed.

import { MessageQueue, type ChatMessage } from "../banter/chat-source";
import { ApiError } from "../core/errors";
import { getSecret } from "../auth/secrets-cache";
import type { ChatConnector, ConnectorStatus } from "./chat-connector";

export const YOUTUBE_OAUTH_KEY = "youtube_oauth_token";

export class YouTubeConnector implements ChatConnector {
	readonly platform = "youtube" as const;
	private queue = new MessageQueue();
	private status: ConnectorStatus;

	constructor(public readonly channel: string) {
		this.status = { platform: "youtube", channel, state: "idle" };
	}

	async connect(): Promise<void> {
		const token = getSecret(YOUTUBE_OAUTH_KEY);
		if (!token) {
			this.status = {
				...this.status,
				state: "error",
				error: "YouTube chat requires Google OAuth — connect in Settings",
			};
			throw new ApiError(401, "YouTube", "OAuth token missing");
		}
		// TODO: implement liveBroadcasts.list + liveChatMessages.list polling
		// loop once the OAuth flow is wired in Settings.
		this.status = {
			...this.status,
			state: "error",
			error: "YouTube live chat polling not yet implemented",
		};
		throw new ApiError(501, "YouTube", "Connector not implemented");
	}

	disconnect(): void {
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
		return !!getSecret(YOUTUBE_OAUTH_KEY);
	}
}
