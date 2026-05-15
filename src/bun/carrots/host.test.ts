// Host integration test — installs an in-tmpdir carrot whose worker
// echoes invoke params back, then exercises the full RPC round-trip.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetDbForTesting, setDbForTesting } from "../db/schema";
import { installFromDir, setEnabled } from "./store";
import { carrotHost } from "./host";

const ECHO_WORKER = `
const bootstrap = process.env.WECLANK_CARROT_BOOTSTRAP;
if (!bootstrap) { console.error("missing bootstrap"); process.exit(1); }
const decoded = JSON.parse(Buffer.from(bootstrap, "base64").toString("utf8"));

function send(msg) { process.stdout.write(JSON.stringify(msg) + "\\n"); }

let buf = "";
process.stdin.on("data", (chunk) => {
	buf += chunk.toString("utf8");
	for (;;) {
		const nl = buf.indexOf("\\n");
		if (nl < 0) break;
		const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
		if (!line.trim()) continue;
		const msg = JSON.parse(line);
		if (msg.type === "invoke" && msg.method === "echo") {
			send({ type: "invoke-response", requestId: msg.requestId, success: true, payload: { you_sent: msg.params, carrot: decoded.manifest.id } });
		} else if (msg.type === "invoke") {
			send({ type: "invoke-response", requestId: msg.requestId, success: false, error: "unknown method" });
		}
	}
});

send({ type: "action", action: "log", payload: { level: "info", message: "echo carrot up" } });
`;

let fixtureDir = "";

beforeEach(() => {
	setDbForTesting(new Database(":memory:"));
});

afterEach(async () => {
	await carrotHost.stopAll();
	resetDbForTesting();
	if (fixtureDir) {
		await rm(fixtureDir, { recursive: true, force: true }).catch(() => {});
		fixtureDir = "";
	}
});

async function makeEchoFixture(): Promise<string> {
	const dir = join(tmpdir(), `weclank-carrot-echo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "carrot.json"), JSON.stringify({
		id: "echo",
		name: "Echo",
		version: "0.1.0",
		description: "test",
		permissions: { bun: { read: true }, isolation: "subprocess" },
		worker: { relativePath: "worker.mjs" },
	}));
	await writeFile(join(dir, "worker.mjs"), ECHO_WORKER);
	return dir;
}

describe("carrot host", () => {
	test("starts a carrot and invokes a worker method", async () => {
		fixtureDir = await makeEchoFixture();
		await installFromDir({ sourcePath: fixtureDir, granted: { bun: { read: true } } });
		await setEnabled("echo", true);
		await carrotHost.start("echo");
		expect(carrotHost.isRunning("echo")).toBe(true);

		const result = await carrotHost.invoke("echo", "echo", { hello: "world" });
		expect(result).toEqual({ you_sent: { hello: "world" }, carrot: "echo" });

		await carrotHost.stop("echo");
		expect(carrotHost.isRunning("echo")).toBe(false);
	}, 15_000);

	test("invoke rejects when carrot is not running", async () => {
		await expect(carrotHost.invoke("missing", "echo", {})).rejects.toThrow(/not running/);
	});

	test("worker error surfaces as a rejected promise", async () => {
		fixtureDir = await makeEchoFixture();
		await installFromDir({ sourcePath: fixtureDir, granted: { bun: { read: true } } });
		await setEnabled("echo", true);
		await carrotHost.start("echo");
		await expect(carrotHost.invoke("echo", "no-such-method", {})).rejects.toThrow(/unknown method/);
		await carrotHost.stop("echo");
	}, 15_000);
});
