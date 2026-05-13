import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { openDb, resetDbForTesting, setDbForTesting } from "./schema";
import {
	deleteSecret,
	loadAllSecrets,
	loadSecret,
	setSecret,
	setSecretStoreForTesting,
	type SecretStore,
} from "./state";

class MemorySecretStore implements SecretStore {
	private readonly values = new Map<string, string>();
	deleted: string[] = [];

	async read(account: string, service: string): Promise<string | null> {
		return this.values.get(`${account}:${service}`) ?? null;
	}

	async write(account: string, service: string, value: string): Promise<void> {
		this.values.set(`${account}:${service}`, value);
	}

	async delete(account: string, service: string): Promise<void> {
		this.deleted.push(`${account}:${service}`);
		this.values.delete(`${account}:${service}`);
	}
}

describe("state secrets", () => {
	beforeEach(() => {
		setDbForTesting(new Database(":memory:"));
	});

	afterEach(() => {
		setSecretStoreForTesting(undefined);
		resetDbForTesting();
	});

	test("stores supported secrets behind a keychain marker", async () => {
		const store = new MemorySecretStore();
		setSecretStoreForTesting(store);

		const result = await setSecret("u-1", "openrouter", "sk-or-test");
		expect(result.storage).toBe("keychain");
		expect(await loadSecret("u-1", "openrouter")).toBe("sk-or-test");
		expect((await loadAllSecrets("u-1"))["openrouter"]).toBe("sk-or-test");

		const db = await openDb();
		const row = db.query("SELECT value FROM user_secrets WHERE user_id = ? AND key_name = ?").get("u-1", "openrouter") as
			| { value: string }
			| null;
		expect(row?.value).toBe("weclank:keychain:v1");
	});

	test("uses SQLite storage when no secret store is available", async () => {
		setSecretStoreForTesting(null);

		const result = await setSecret("u-1", "rtmp_destinations", "stream-key");
		expect(result.storage).toBe("sqlite");
		expect(await loadSecret("u-1", "rtmp_destinations")).toBe("stream-key");
	});

	test("keeps reading legacy plaintext rows", async () => {
		const db = await openDb();
		db.run("INSERT INTO user_secrets (user_id, key_name, value, updated_at) VALUES (?, ?, ?, ?)", [
			"u-1",
			"openai",
			"sk-legacy",
			Date.now(),
		]);

		expect(await loadSecret("u-1", "openai")).toBe("sk-legacy");
	});

	test("deletes the keychain entry with the database row", async () => {
		const store = new MemorySecretStore();
		setSecretStoreForTesting(store);

		await setSecret("u-1", "openrouter", "sk-or-test");
		await deleteSecret("u-1", "openrouter");

		expect(store.deleted).toEqual(["u-1:Weclank:openrouter"]);
		expect(await loadSecret("u-1", "openrouter")).toBe("");
	});
});
