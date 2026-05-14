// Per-platform chat connector — extends ChatSource with platform identity
// and optional moderation actions. ChatBus instantiates one connector per
// non-empty platform channel id and merges their message streams.
//
// `moderate()` is optional. Connectors that lack a public mod API (Kick,
// YouTube without OAuth) simply omit it; the UI hides mod controls when
// the connector reports `supportsModeration()` false.

import type { ChatMessage, ChatSource } from "../banter/chat-source";
import type { ChatPlatformId } from "../core/types";

export type ModerateAction =
	| { kind: "delete"; messageId: string }
	| { kind: "timeout"; userId: string; durationSec: number; reason?: string }
	| { kind: "ban"; userId: string; reason?: string };

export interface ConnectorStatus {
	platform: ChatPlatformId;
	channel: string;
	state: "idle" | "connecting" | "connected" | "error";
	/** Last error message, if any. */
	error?: string;
}

export interface ChatConnector extends ChatSource {
	readonly platform: ChatPlatformId;
	readonly channel: string;
	getStatus(): ConnectorStatus;
	supportsModeration(): boolean;
	moderate?(action: ModerateAction): Promise<void>;
}

/** Helper: stamp platform and (when known) message ids into a message
 * before pushing to the queue. Connectors call this so every message
 * downstream knows where it came from. */
export function stampMessage(msg: ChatMessage, platform: ChatPlatformId): ChatMessage {
	return msg.platform ? msg : { ...msg, platform };
}
