import { describe, expect, test } from "bun:test";
import { parsePrivmsg } from "./twitch-chat";

describe("parsePrivmsg", () => {
	test("parses a tagged PRIVMSG with display-name", () => {
		const line = "@badge-info=;color=#FF7F50;display-name=Alice :alice!alice@alice.tmi.twitch.tv PRIVMSG #channel :hello world";
		const msg = parsePrivmsg(line);
		expect(msg).not.toBeNull();
		expect(msg!.author).toBe("Alice");
		expect(msg!.text).toBe("hello world");
		expect(msg!.meta?.["channel"]).toBe("#channel");
	});

	test("falls back to nick when display-name is missing", () => {
		const line = "@badge-info= :bob!bob@bob.tmi.twitch.tv PRIVMSG #channel :hi";
		const msg = parsePrivmsg(line);
		expect(msg).not.toBeNull();
		expect(msg!.author).toBe("bob");
	});

	test("handles a PRIVMSG without tags at all", () => {
		const line = ":carl!carl@host PRIVMSG #channel :no tags here";
		const msg = parsePrivmsg(line);
		expect(msg).not.toBeNull();
		expect(msg!.author).toBe("carl");
		expect(msg!.text).toBe("no tags here");
	});

	test("returns null for non-PRIVMSG lines", () => {
		expect(parsePrivmsg("PING :tmi.twitch.tv")).toBeNull();
		expect(parsePrivmsg(":server 001 nick :Welcome")).toBeNull();
		expect(parsePrivmsg("")).toBeNull();
	});

	test("preserves emoji and special chars in the message body", () => {
		const line = "@display-name=Dee :dee!dee@host PRIVMSG #channel :LULW :^) emote 👀";
		const msg = parsePrivmsg(line);
		expect(msg).not.toBeNull();
		expect(msg!.text).toBe("LULW :^) emote 👀");
	});

	test("timestamp is populated", () => {
		const before = Date.now();
		const msg = parsePrivmsg(":x!x@host PRIVMSG #c :y");
		const after = Date.now();
		expect(msg).not.toBeNull();
		expect(msg!.timestamp).toBeGreaterThanOrEqual(before);
		expect(msg!.timestamp).toBeLessThanOrEqual(after);
	});

	test("extracts message id and user id from tags (for mod actions)", () => {
		const line = "@id=abc-123;user-id=999;color=#FF0000;display-name=Alice :alice!alice@host PRIVMSG #channel :spam";
		const msg = parsePrivmsg(line);
		expect(msg).not.toBeNull();
		expect(msg!.meta?.["msgId"]).toBe("abc-123");
		expect(msg!.meta?.["userId"]).toBe("999");
		expect(msg!.meta?.["color"]).toBe("#FF0000");
	});
});
