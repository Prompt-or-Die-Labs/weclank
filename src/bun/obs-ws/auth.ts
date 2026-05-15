// SHA-256 challenge auth per obs-websocket v5 spec.
//
// Server: generate 32 random bytes for both `salt` and `challenge`;
// send `{ challenge, salt }` in Hello.
// Client: compute `secret = base64(sha256(password + salt))`, then
// `authString = base64(sha256(secret + challenge))`, send `authString`
// in Identify.authentication.
// Server: recompute the same authString from its stored password +
// emitted salt + emitted challenge; compare via constant-time match.

import { randomBytes } from "node:crypto";

function sha256Base64(input: string): string {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(input);
	return hasher.digest("base64");
}

export function generateSalt(): string {
	return randomBytes(32).toString("base64");
}

export function generateChallenge(): string {
	return randomBytes(32).toString("base64");
}

export interface AuthSession {
	salt: string;
	challenge: string;
}

export function newAuthSession(): AuthSession {
	return {
		salt: generateSalt(),
		challenge: generateChallenge(),
	};
}

/** Compute the expected authString given a stored password + an issued
 *  auth session. The client should arrive at the same value. */
export function computeAuthString(password: string, session: AuthSession): string {
	const secret = sha256Base64(password + session.salt);
	return sha256Base64(secret + session.challenge);
}

/** Constant-time string compare to avoid leaking byte-level timing
 *  on a bad password. */
export function constantTimeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let mismatch = 0;
	for (let i = 0; i < a.length; i++) {
		mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return mismatch === 0;
}

/** Verify a client-supplied authString. Returns true if it matches
 *  what the server expects given its password + the issued session. */
export function verifyAuth(
	clientAuthString: string,
	password: string,
	session: AuthSession,
): boolean {
	const expected = computeAuthString(password, session);
	return constantTimeEqual(clientAuthString, expected);
}
