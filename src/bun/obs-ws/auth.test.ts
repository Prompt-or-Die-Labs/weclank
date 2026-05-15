import { describe, expect, test } from "bun:test";
import {
	computeAuthString,
	constantTimeEqual,
	generateChallenge,
	generateSalt,
	newAuthSession,
	verifyAuth,
} from "./auth";

describe("obs-websocket auth — SHA-256 challenge", () => {
	test("salt and challenge are 32-byte base64 strings", () => {
		const salt = generateSalt();
		const challenge = generateChallenge();
		// base64 of 32 bytes = 44 chars including trailing `=`.
		expect(salt.length).toBe(44);
		expect(challenge.length).toBe(44);
		expect(salt).toMatch(/^[A-Za-z0-9+/=]+$/);
	});

	test("newAuthSession yields fresh salt+challenge every call", () => {
		const a = newAuthSession();
		const b = newAuthSession();
		expect(a.salt).not.toBe(b.salt);
		expect(a.challenge).not.toBe(b.challenge);
	});

	test("computeAuthString is deterministic for the same inputs", () => {
		const session = { salt: "fixed-salt", challenge: "fixed-challenge" };
		const a = computeAuthString("password123", session);
		const b = computeAuthString("password123", session);
		expect(a).toBe(b);
	});

	test("verifyAuth accepts a correctly computed authString", () => {
		const session = newAuthSession();
		const auth = computeAuthString("secret-pw", session);
		expect(verifyAuth(auth, "secret-pw", session)).toBe(true);
	});

	test("verifyAuth rejects wrong password", () => {
		const session = newAuthSession();
		const auth = computeAuthString("secret-pw", session);
		expect(verifyAuth(auth, "wrong-pw", session)).toBe(false);
	});

	test("verifyAuth rejects malformed authString", () => {
		const session = newAuthSession();
		expect(verifyAuth("nope", "secret-pw", session)).toBe(false);
	});

	test("constantTimeEqual returns true for identical strings, false otherwise", () => {
		expect(constantTimeEqual("abc", "abc")).toBe(true);
		expect(constantTimeEqual("abc", "abd")).toBe(false);
		expect(constantTimeEqual("abc", "abcd")).toBe(false);
		expect(constantTimeEqual("", "")).toBe(true);
	});
});
