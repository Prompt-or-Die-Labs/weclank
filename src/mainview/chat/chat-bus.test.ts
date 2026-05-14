// ChatBus unit tests. Verifies the aggregator's sync/disconnect lifecycle
// and its multi-listener fanout. Uses inject() to push synthetic messages
// since real connectors require live network.

import { afterEach, describe, expect, test } from "bun:test";
import { chatBus } from "./chat-bus";
import type { ChatMessage } from "../banter/chat-source";

afterEach(() => {
	chatBus.clear();
});

describe("chatBus.inject + subscribe", () => {
	test("fans an injected message to every subscriber", () => {
		const a: ChatMessage[] = [];
		const b: ChatMessage[] = [];
		const unsubA = chatBus.subscribe((m) => a.push(m));
		const unsubB = chatBus.subscribe((m) => b.push(m));

		chatBus.inject({ author: "tester", text: "hello", timestamp: 1, platform: "twitch" });

		expect(a).toHaveLength(1);
		expect(b).toHaveLength(1);
		expect(a[0]!.platform).toBe("twitch");
		unsubA();
		unsubB();
	});

	test("unsubscribed listeners stop receiving messages", () => {
		const received: ChatMessage[] = [];
		const unsub = chatBus.subscribe((m) => received.push(m));
		chatBus.inject({ author: "x", text: "first", timestamp: 1, platform: "twitch" });
		unsub();
		chatBus.inject({ author: "x", text: "second", timestamp: 2, platform: "twitch" });
		expect(received).toHaveLength(1);
		expect(received[0]!.text).toBe("first");
	});

	test("getHistory returns the recent messages newest-last", () => {
		chatBus.inject({ author: "a", text: "1", timestamp: 1, platform: "twitch" });
		chatBus.inject({ author: "b", text: "2", timestamp: 2, platform: "kick" });
		chatBus.inject({ author: "c", text: "3", timestamp: 3, platform: "twitch" });
		const history = chatBus.getHistory();
		expect(history.map((m) => m.text)).toEqual(["1", "2", "3"]);
		expect(history.map((m) => m.platform)).toEqual(["twitch", "kick", "twitch"]);
	});

	test("getHistory respects the limit (most-recent N)", () => {
		for (let i = 0; i < 10; i++) {
			chatBus.inject({ author: "x", text: `m${i}`, timestamp: i, platform: "twitch" });
		}
		const last5 = chatBus.getHistory(5);
		expect(last5).toHaveLength(5);
		expect(last5.map((m) => m.text)).toEqual(["m5", "m6", "m7", "m8", "m9"]);
	});
});

describe("chatBus.clear", () => {
	test("removes history and silences listeners until next inject", () => {
		const received: ChatMessage[] = [];
		chatBus.subscribe((m) => received.push(m));
		chatBus.inject({ author: "a", text: "before", timestamp: 1, platform: "twitch" });
		expect(received).toHaveLength(1);
		chatBus.clear();
		expect(chatBus.getHistory()).toEqual([]);
		chatBus.inject({ author: "a", text: "after", timestamp: 2, platform: "twitch" });
		// Listener stays registered through clear() — only connectors/history reset.
		expect(received).toHaveLength(2);
	});
});

describe("chatBus.sync (lifecycle stub)", () => {
	// Real connectors aren't tested here (they'd need live network);
	// instead verify that sync({}) is idempotent and getStatuses reflects
	// the absence of configured channels.
	test("sync with empty map leaves no connectors", () => {
		chatBus.sync({});
		expect(chatBus.getStatuses()).toEqual([]);
		expect(chatBus.isConnected()).toBe(false);
	});

	test("sync is idempotent — repeat calls don't churn", () => {
		chatBus.sync({});
		chatBus.sync({});
		chatBus.sync({});
		expect(chatBus.getStatuses()).toEqual([]);
	});
});
