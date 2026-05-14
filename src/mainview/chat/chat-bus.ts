// ChatBus — central aggregator. Owns one ChatConnector per platform with
// a configured channel id, fans every connector's messages into a single
// shared ring buffer + subscribers list.
//
// Consumers (ChatTab, chat-overlay, banter-engine) call `subscribe()` and
// receive every new message as it arrives. They render / react however
// they want — the bus stays platform-agnostic.
//
// Sync model: `sync(channels)` is idempotent. Pass the current
// per-platform channel map; the bus tears down connectors whose channel
// disappeared, leaves matching ones running, and spins up new ones.
// Called whenever state.overlays.chat changes.

import type { ChatMessage } from "../banter/chat-source";
import { audienceIntelligence } from "../banter/audience-intelligence";
import type { ChatPlatformId } from "../core/types";
import { TwitchConnector } from "./twitch-connector";
import { KickConnector } from "./kick-connector";
import { YouTubeConnector } from "./youtube-connector";
import type { ChatConnector, ConnectorStatus, ModerateAction } from "./chat-connector";

export type ChannelMap = Partial<Record<ChatPlatformId, string>>;

const HISTORY_CAP = 500;

type Listener = (msg: ChatMessage) => void;
type StatusListener = (statuses: ConnectorStatus[]) => void;

class ChatBus {
	private connectors = new Map<ChatPlatformId, ChatConnector>();
	private history: ChatMessage[] = [];
	private listeners = new Set<Listener>();
	private statusListeners = new Set<StatusListener>();

	/** Reconcile the running connectors with the desired channel map.
	 * - Channels in the map that aren't running → spawn + connect.
	 * - Running connectors not in the map (or with a different channel) → disconnect.
	 * - Matching channels → leave alone. */
	sync(channels: ChannelMap): void {
		const wanted = new Map<ChatPlatformId, string>();
		for (const [platform, channel] of Object.entries(channels) as [ChatPlatformId, string | undefined][]) {
			if (channel && channel.trim()) wanted.set(platform, channel.trim());
		}
		// Tear down anything stale.
		for (const [platform, conn] of this.connectors) {
			const next = wanted.get(platform);
			if (!next || next.toLowerCase() !== conn.channel.toLowerCase()) {
				conn.disconnect();
				this.connectors.delete(platform);
			}
		}
		// Spin up new connectors.
		for (const [platform, channel] of wanted) {
			if (this.connectors.has(platform)) continue;
			const conn = makeConnector(platform, channel);
			this.connectors.set(platform, conn);
			void this.attach(conn);
		}
		this.emitStatuses();
	}

	/** Hard reset — disconnect everything and clear history. Used on
	 * logout / app teardown. */
	clear(): void {
		for (const conn of this.connectors.values()) conn.disconnect();
		this.connectors.clear();
		this.history = [];
		audienceIntelligence.clear();
		this.emitStatuses();
	}

	/** Most-recent N messages, newest last. Bounded for memory. */
	getHistory(limit = HISTORY_CAP): ChatMessage[] {
		if (limit >= this.history.length) return this.history.slice();
		return this.history.slice(this.history.length - limit);
	}

	/** Per-platform connector status (for showing per-platform dots in the UI). */
	getStatuses(): ConnectorStatus[] {
		return Array.from(this.connectors.values()).map((c) => c.getStatus());
	}

	/** Returns true when at least one connector is in `connected` state. */
	isConnected(): boolean {
		for (const conn of this.connectors.values()) {
			if (conn.getStatus().state === "connected") return true;
		}
		return false;
	}

	/** Subscribe to incoming messages. Returns an unsubscribe fn. */
	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => { this.listeners.delete(listener); };
	}

	subscribeStatuses(listener: StatusListener): () => void {
		this.statusListeners.add(listener);
		return () => { this.statusListeners.delete(listener); };
	}

	/** Push a synthetic message into the bus. Used by chat-input and
	 * tests; bypasses any connector. */
	inject(msg: ChatMessage): void {
		this.recordAndFanout(msg);
	}

	/** Execute a moderation action against the connector for the message's
	 * platform. Throws ApiError if the platform doesn't support mod
	 * actions (e.g., Kick). */
	async moderate(platform: ChatPlatformId, action: ModerateAction): Promise<void> {
		const conn = this.connectors.get(platform);
		if (!conn) throw new Error(`No active connector for ${platform}`);
		if (!conn.supportsModeration() || !conn.moderate) {
			throw new Error(`${platform} doesn't support moderation`);
		}
		await conn.moderate(action);
	}

	private async attach(conn: ChatConnector): Promise<void> {
		try {
			await conn.connect();
			this.emitStatuses();
		} catch (err) {
			console.warn(`[chat-bus] ${conn.platform} connect failed`, err);
			this.emitStatuses();
			return;
		}
		try {
			for await (const msg of conn.messages()) {
				// The connector may have been replaced by a sync() call —
				// only fan out if it's still the active one.
				if (this.connectors.get(conn.platform) !== conn) break;
				this.recordAndFanout(msg);
			}
		} catch (err) {
			console.warn(`[chat-bus] ${conn.platform} stream ended`, err);
		}
	}

	private recordAndFanout(msg: ChatMessage): void {
		this.history.push(msg);
		if (this.history.length > HISTORY_CAP) {
			this.history = this.history.slice(this.history.length - HISTORY_CAP);
		}
		audienceIntelligence.recordMessage(msg);
		for (const listener of this.listeners) {
			try { listener(msg); } catch (err) { console.warn("[chat-bus] listener threw", err); }
		}
	}

	private emitStatuses(): void {
		const snapshot = this.getStatuses();
		for (const listener of this.statusListeners) {
			try { listener(snapshot); } catch (err) { console.warn("[chat-bus] status listener threw", err); }
		}
	}
}

function makeConnector(platform: ChatPlatformId, channel: string): ChatConnector {
	switch (platform) {
		case "twitch":  return new TwitchConnector(channel);
		case "kick":    return new KickConnector(channel);
		case "youtube": return new YouTubeConnector(channel);
	}
}

export const chatBus = new ChatBus();
