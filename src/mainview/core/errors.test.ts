import { describe, expect, test } from "bun:test";
import {
	ApiError,
	AuthError,
	ConfigError,
	StudioError,
	ToolInvocationError,
	userMessageFor,
} from "./errors";

describe("StudioError", () => {
	test("falls back userMessage to message when not provided", () => {
		const err = new StudioError("disk full");
		expect(err.message).toBe("disk full");
		expect(err.userMessage).toBe("disk full");
	});

	test("keeps userMessage distinct when provided", () => {
		const err = new StudioError("ENOSPC at /var/db", "Out of disk space.");
		expect(err.message).toBe("ENOSPC at /var/db");
		expect(err.userMessage).toBe("Out of disk space.");
	});

	test("subclass .name reflects the concrete class", () => {
		const err = new ConfigError("missing key");
		expect(err.name).toBe("ConfigError");
		expect(err).toBeInstanceOf(StudioError);
	});

	test("subclasses each retain their own .name", () => {
		expect(new AuthError("x").name).toBe("AuthError");
		expect(new ToolInvocationError("x").name).toBe("ToolInvocationError");
	});
});

describe("ApiError friendly messages", () => {
	test("401 → re-check API key", () => {
		const err = new ApiError(401, "ElevenLabs", "Unauthorized");
		expect(err.userMessage).toMatch(/rejected the API key/);
		expect(err.userMessage).toContain("ElevenLabs");
	});

	test("403 routes through the same auth-rejected message", () => {
		const err = new ApiError(403, "OpenRouter", "Forbidden");
		expect(err.userMessage).toMatch(/rejected the API key/);
	});

	test("429 says rate-limited", () => {
		const err = new ApiError(429, "Suno", "Too Many");
		expect(err.userMessage).toMatch(/rate-limiting/);
	});

	test("5xx says the service is having a bad day", () => {
		expect(new ApiError(500, "X", "boom").userMessage).toMatch(/bad day/);
		expect(new ApiError(503, "X", "boom").userMessage).toMatch(/bad day/);
	});

	test("other 4xx gets the generic 'request failed' line", () => {
		expect(new ApiError(404, "X", "missing").userMessage).toBe("X request failed (HTTP 404).");
	});

	test("trims long bodies in .message but keeps the HTTP signature", () => {
		const body = "x".repeat(500);
		const err = new ApiError(500, "Suno", body);
		expect(err.message).toContain("Suno HTTP 500");
		// Stored body trimmed to 200 chars.
		expect(err.body.length).toBe(200);
	});

	test("empty body still produces a sensible developer message", () => {
		const err = new ApiError(500, "X", "");
		expect(err.message).toBe("X HTTP 500: no body");
	});
});

describe("userMessageFor", () => {
	test("returns .userMessage for StudioError", () => {
		const err = new AuthError("argon2 mismatch", "Incorrect password.");
		expect(userMessageFor(err)).toBe("Incorrect password.");
	});

	test("returns .message for plain Error", () => {
		expect(userMessageFor(new Error("network down"))).toBe("network down");
	});

	test("stringifies non-Error throwables", () => {
		expect(userMessageFor("string thrown")).toBe("string thrown");
		expect(userMessageFor(42)).toBe("42");
		expect(userMessageFor(null)).toBe("null");
		expect(userMessageFor(undefined)).toBe("undefined");
	});
});
