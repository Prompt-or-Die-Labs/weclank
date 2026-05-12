import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { resetDbForTesting, setDbForTesting } from "./schema";
import { signup, login, checkUser, deleteAccount, lookupUsername } from "./users";

describe("users", () => {
	beforeEach(() => {
		setDbForTesting(new Database(":memory:"));
	});

	afterEach(() => {
		resetDbForTesting();
	});

	test("signup creates a user with a hashed password", async () => {
		const result = await signup("dev", "secret-pass-1");
		expect("userId" in result).toBe(true);
		if (!("userId" in result)) return;
		expect(result.userId).toMatch(/^u-/);
	});

	test("signup rejects an invalid username", async () => {
		const result = await signup("xx", "ok-password");
		expect("error" in result).toBe(true);
	});

	test("signup rejects a short password", async () => {
		const result = await signup("valid_user", "short");
		expect("error" in result).toBe(true);
	});

	test("signup is unique by username", async () => {
		const a = await signup("dev", "good-password");
		expect("userId" in a).toBe(true);
		const b = await signup("dev", "different-password");
		expect("error" in b).toBe(true);
	});

	test("login verifies the password", async () => {
		await signup("dev", "right-password");
		const ok = await login("dev", "right-password");
		expect("userId" in ok).toBe(true);
		const bad = await login("dev", "wrong-password");
		expect("error" in bad).toBe(true);
	});

	test("login rejects unknown usernames", async () => {
		const result = await login("ghost", "anything-here");
		expect("error" in result).toBe(true);
	});

	test("checkUser reflects existence", async () => {
		await signup("dev", "good-password");
		expect((await checkUser("dev")).exists).toBe(true);
		expect((await checkUser("nobody")).exists).toBe(false);
	});

	test("lookupUsername returns the username for a known id", async () => {
		const signupResult = await signup("dev", "good-password");
		if (!("userId" in signupResult)) throw new Error("signup failed");
		const lookup = await lookupUsername(signupResult.userId);
		expect(lookup.username).toBe("dev");
	});

	test("deleteAccount removes the user", async () => {
		const signupResult = await signup("dev", "good-password");
		if (!("userId" in signupResult)) throw new Error("signup failed");
		const del = await deleteAccount(signupResult.userId);
		expect(del.success).toBe(true);
		expect((await checkUser("dev")).exists).toBe(false);
	});
});
