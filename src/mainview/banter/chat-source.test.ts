import { describe, expect, test } from "bun:test";
import { MessageQueue } from "./chat-source";

describe("MessageQueue", () => {
	test("buffered messages are yielded in order", async () => {
		const q = new MessageQueue();
		q.push({ author: "a", text: "1", timestamp: 1 });
		q.push({ author: "a", text: "2", timestamp: 2 });
		q.close();
		const seen: string[] = [];
		for await (const m of q) seen.push(m.text);
		expect(seen).toEqual(["1", "2"]);
	});

	test("resolves a pending iterator next() when a message arrives", async () => {
		const q = new MessageQueue();
		const iter = q[Symbol.asyncIterator]();
		const pending = iter.next();
		// Push after the consumer is parked.
		setTimeout(() => q.push({ author: "a", text: "later", timestamp: 1 }), 5);
		const result = await pending;
		expect(result.done).toBe(false);
		expect(result.value.text).toBe("later");
		q.close();
	});

	test("close signals done to subsequent next() calls", async () => {
		const q = new MessageQueue();
		q.close();
		const iter = q[Symbol.asyncIterator]();
		const result = await iter.next();
		expect(result.done).toBe(true);
	});

	test("close drains pending resolvers with done", async () => {
		const q = new MessageQueue();
		const iter = q[Symbol.asyncIterator]();
		const pending = iter.next();
		q.close();
		const result = await pending;
		expect(result.done).toBe(true);
	});

	test("push after close is a no-op", async () => {
		const q = new MessageQueue();
		q.close();
		q.push({ author: "ignored", text: "ignored", timestamp: 0 });
		const seen: string[] = [];
		for await (const m of q) seen.push(m.text);
		expect(seen).toEqual([]);
	});
});
