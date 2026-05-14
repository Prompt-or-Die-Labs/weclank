// ChatSource — the abstract interface the banter engine consumes. Each
// implementation pushes messages onto an async iterator; the engine awaits
// them and decides whether to respond.

import type { ChatPlatformId } from "../core/types";

export interface ChatMessage {
	author: string;
	text: string;
	timestamp: number;
	/** Platform this message came from. Stable across the message's life;
	 * used by the chat tab to render platform badges and route mod
	 * actions. Optional for back-compat with legacy injected messages. */
	platform?: ChatPlatformId;
	/** Stable id assigned by the platform (Twitch's `tags.id`, Kick's
	 * message UUID, YouTube's commentId). Required for mod actions. */
	messageId?: string;
	/** Stable id of the author on the platform — for ban/timeout. */
	authorId?: string;
	/** Free-form metadata (channel name, badges, color, etc.). */
	meta?: Record<string, string>;
}

export interface ChatSource {
	connect(): Promise<void>;
	disconnect(): void;
	/** Async-pull iterator. The engine `for await`s this until it sees
	 * `done`, which only happens after disconnect(). */
	messages(): AsyncIterable<ChatMessage>;
}

/** Helper: producer-side queue with promise resolvers for `for await` callers. */
export class MessageQueue {
	private buffer: ChatMessage[] = [];
	private resolvers: Array<(msg: IteratorResult<ChatMessage>) => void> = [];
	private closed = false;

	push(msg: ChatMessage): void {
		if (this.closed) return;
		const resolver = this.resolvers.shift();
		if (resolver) resolver({ value: msg, done: false });
		else this.buffer.push(msg);
	}

	close(): void {
		this.closed = true;
		for (const r of this.resolvers) r({ value: undefined as unknown as ChatMessage, done: true });
		this.resolvers = [];
	}

	[Symbol.asyncIterator](): AsyncIterator<ChatMessage> {
		return {
			next: (): Promise<IteratorResult<ChatMessage>> => {
				if (this.buffer.length > 0) {
					return Promise.resolve({ value: this.buffer.shift()!, done: false });
				}
				if (this.closed) {
					return Promise.resolve({ value: undefined as unknown as ChatMessage, done: true });
				}
				return new Promise<IteratorResult<ChatMessage>>((resolve) => {
					this.resolvers.push(resolve);
				});
			},
		};
	}
}
