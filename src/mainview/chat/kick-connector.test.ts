// Kick connector — frame parsers only (no live network in tests).

import { describe, expect, test } from "bun:test";
import { parseKickChatMessage, parsePusherFrame } from "./kick-connector";

describe("parsePusherFrame", () => {
	test("parses a chat-message envelope", () => {
		const frame = parsePusherFrame(JSON.stringify({
			event: "App\\Events\\ChatMessageEvent",
			channel: "chatrooms.123.v2",
			data: '{"id":"abc"}',
		}));
		expect(frame?.event).toBe("App\\Events\\ChatMessageEvent");
		expect(frame?.channel).toBe("chatrooms.123.v2");
		expect(frame?.data).toBe('{"id":"abc"}');
	});

	test("parses control events that don't carry data", () => {
		const frame = parsePusherFrame(JSON.stringify({
			event: "pusher:connection_established",
		}));
		expect(frame?.event).toBe("pusher:connection_established");
		expect(frame?.data).toBeUndefined();
	});

	test("returns null for malformed frames", () => {
		expect(parsePusherFrame("not-json")).toBeNull();
		expect(parsePusherFrame("{}")).toBeNull(); // missing event
	});
});

describe("parseKickChatMessage", () => {
	test("converts a ChatMessageEvent body into a ChatMessage", () => {
		const data = JSON.stringify({
			id: "msg-1",
			chatroom_id: 99,
			content: "hello world",
			type: "message",
			created_at: "2024-05-13T14:00:00Z",
			sender: {
				id: 42,
				username: "Streamer",
				slug: "streamer",
				identity: { color: "#FFAA00", badges: [] },
			},
		});
		const msg = parseKickChatMessage(data);
		expect(msg).not.toBeNull();
		expect(msg!.author).toBe("Streamer");
		expect(msg!.text).toBe("hello world");
		expect(msg!.platform).toBe("kick");
		expect(msg!.messageId).toBe("msg-1");
		expect(msg!.authorId).toBe("42");
		expect(msg!.meta?.["color"]).toBe("#FFAA00");
		expect(msg!.meta?.["channel"]).toBe("streamer");
	});

	test("returns null when content is missing", () => {
		expect(parseKickChatMessage(JSON.stringify({
			id: "msg-1",
			sender: { id: 1, username: "x", slug: "x" },
		}))).toBeNull();
	});

	test("returns null when sender is missing", () => {
		expect(parseKickChatMessage(JSON.stringify({
			id: "msg-1",
			content: "hello",
		}))).toBeNull();
	});

	test("returns null for malformed JSON", () => {
		expect(parseKickChatMessage("not-json")).toBeNull();
		expect(parseKickChatMessage(undefined)).toBeNull();
	});

	test("falls back to current time when created_at is missing", () => {
		const before = Date.now();
		const msg = parseKickChatMessage(JSON.stringify({
			id: "msg-1",
			chatroom_id: 99,
			content: "hi",
			sender: { id: 1, username: "x", slug: "x" },
		}));
		expect(msg!.timestamp).toBeGreaterThanOrEqual(before);
	});
});
