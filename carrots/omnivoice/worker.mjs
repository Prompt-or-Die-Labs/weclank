// OmniVoice carrot worker — Weclank-standalone (no ~/.eliza dependency).
//
// Spawns the local `omnivoice-tts` binary (built via
// `bun run build:omnivoice`) with the Q4_K_M model + tokenizer codec
// under ~/.weclank/local-inference/. The binary exits per synthesize
// call (one-shot CLI), so the worker re-spawns it each time; cold start
// is small on M-series.
//
// Upstream omnivoice.cpp went through a rename: the old binary was
// `llama-omnivoice-server` (long-running HTTP server) and the new one
// is `omnivoice-tts` (one-shot CLI: stdin text → WAV out). Flags
// changed too — there's no `--threads` and `--flash-attn` flipped to
// `--no-fa` (FA is on by default; pass --no-fa to disable).
//
// Methods over JSON-over-stdio:
//   status              → { binary, model, codec, binaryExists, modelsExist }
//   prepare             → downloads any missing GGUF models from HuggingFace;
//                         returns final paths + a hint for building the binary
//                         if it's still missing
//   synthesize          → returns { base64, mimeType, byteLength } for one WAV

import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, statSync, existsSync } from "node:fs";
import { mkdir, readFile, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const bootstrapEnv = process.env.WECLANK_CARROT_BOOTSTRAP;
if (!bootstrapEnv) {
	console.error("omnivoice: missing WECLANK_CARROT_BOOTSTRAP — not running inside Weclank");
	process.exit(1);
}

const context = JSON.parse(Buffer.from(bootstrapEnv, "base64").toString("utf8"));
mkdirSync(dirname(context.statePath), { recursive: true });

// ── Standalone weclank-owned paths ─────────────────────────────────────
const HOME = homedir();
const ROOT = process.env.WECLANK_LOCAL_INFERENCE_DIR ?? join(HOME, ".weclank", "local-inference");
const BIN_DIR = join(ROOT, "bin");
const MODELS_DIR = join(ROOT, "models");
const BIN_NAME =
	process.platform === "win32" ? "omnivoice-tts.exe" : "omnivoice-tts";

const config = {
	binary: process.env.OMNIVOICE_BIN || join(BIN_DIR, BIN_NAME),
	dyldDir: process.env.OMNIVOICE_DYLD_DIR || BIN_DIR,
	model: process.env.OMNIVOICE_MODEL || join(MODELS_DIR, "omnivoice-base-Q4_K_M.gguf"),
	codec: process.env.OMNIVOICE_CODEC || join(MODELS_DIR, "omnivoice-tokenizer-Q4_K_M.gguf"),
	// FA is on by default in the new CLI — set OMNIVOICE_USE_FA=false to opt out.
	flashAttention: (process.env.OMNIVOICE_USE_FA ?? "true") !== "false",
};

const MODEL_DOWNLOADS = [
	{
		path: config.model,
		url: "https://huggingface.co/Serveurperso/OmniVoice-GGUF/resolve/main/omnivoice-base-Q4_K_M.gguf",
		expectedMinBytes: 350_000_000, // ~407 MB per model card; floor at 350 MB
	},
	{
		path: config.codec,
		url: "https://huggingface.co/Serveurperso/OmniVoice-GGUF/resolve/main/omnivoice-tokenizer-Q4_K_M.gguf",
		expectedMinBytes: 200_000_000, // ~252 MB per model card; floor at 200 MB
	},
];

// ── Logging helpers ────────────────────────────────────────────────────
function logAction(level, message) {
	send({ type: "action", action: "log", payload: { level, message } });
}

function send(msg) {
	process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function fileExists(p) {
	try { return statSync(p).isFile(); } catch { return false; }
}

function statusSnapshot() {
	const binaryExists = fileExists(config.binary);
	const modelsExist = fileExists(config.model) && fileExists(config.codec);
	return {
		binary: config.binary,
		model: config.model,
		codec: config.codec,
		binaryExists,
		modelsExist,
		buildCommand: "bun run build:omnivoice",
		root: ROOT,
	};
}

// ── Model download ─────────────────────────────────────────────────────

async function downloadFile(url, destPath) {
	await mkdir(dirname(destPath), { recursive: true });
	const tmp = `${destPath}.partial`;
	logAction("info", `downloading ${url} → ${destPath}`);
	const res = await fetch(url, { redirect: "follow" });
	if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
	if (!res.body) throw new Error(`No body for ${url}`);
	// Stream to disk so we don't buffer hundreds of MB in memory.
	await new Promise((resolve, reject) => {
		const sink = createWriteStream(tmp);
		sink.on("error", reject);
		sink.on("close", resolve);
		const reader = res.body.getReader();
		(async () => {
			try {
				while (true) {
					const { value, done } = await reader.read();
					if (done) break;
					if (!sink.write(value)) await new Promise((r) => sink.once("drain", r));
				}
				sink.end();
			} catch (err) { reject(err); }
		})();
	});
	// Rename atomically; readers never see a half-written file.
	const { rename } = await import("node:fs/promises");
	await rename(tmp, destPath);
}

async function prepareModels(force = false) {
	const downloaded = [];
	const skipped = [];
	for (const item of MODEL_DOWNLOADS) {
		if (!force && fileExists(item.path)) {
			const s = statSync(item.path);
			if (s.size >= item.expectedMinBytes) {
				skipped.push(item.path);
				continue;
			}
			logAction("warn", `${item.path} exists but is suspiciously small (${s.size} bytes); re-downloading`);
		}
		await downloadFile(item.url, item.path);
		const final = await stat(item.path);
		if (final.size < item.expectedMinBytes) {
			await unlink(item.path).catch(() => {});
			throw new Error(`${item.path} downloaded but only ${final.size} bytes — refusing to use partial model`);
		}
		downloaded.push(item.path);
	}
	return { downloaded, skipped, status: statusSnapshot() };
}

// ── Synthesize ─────────────────────────────────────────────────────────

async function synthesizeOnce({ text, instruct, lang }) {
	if (!text || typeof text !== "string") {
		throw new Error("synthesize: 'text' is required");
	}
	const snap = statusSnapshot();
	if (!snap.binaryExists) {
		throw new Error(
			`omnivoice-tts is not built yet. Run \`${snap.buildCommand}\` from the weclank repo to compile it for this platform.`,
		);
	}
	if (!snap.modelsExist) {
		throw new Error(
			"OmniVoice models are missing. Run the `prepare` carrot method to download them (or call this method again after enabling auto-prepare).",
		);
	}

	const stateDir = dirname(context.statePath);
	const outPath = join(stateDir, `tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`);

	const args = [
		"--model", config.model,
		"--codec", config.codec,
		"-o", outPath,
	];
	// Upstream CLI has FA on by default; pass --no-fa to disable it.
	if (!config.flashAttention) args.push("--no-fa");
	if (instruct) args.push("--instruct", String(instruct));
	if (lang) args.push("--lang", String(lang));

	const env = { ...process.env, DYLD_LIBRARY_PATH: config.dyldDir };

	return new Promise((resolve, reject) => {
		const proc = spawn(config.binary, args, { stdio: ["pipe", "pipe", "pipe"], env });
		let stderr = "";
		proc.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
		proc.stdin.end(text);
		proc.on("error", reject);
		proc.on("exit", (code) => {
			if (code === 0 && fileExists(outPath)) {
				resolve({ wavPath: outPath, bytes: statSync(outPath).size });
			} else {
				reject(new Error(`llama-omnivoice-server exited code=${code}; stderr tail: ${stderr.slice(-400)}`));
			}
		});
	});
}

logAction("info", `omnivoice carrot ready — root=${ROOT}`);

// ── RPC loop ───────────────────────────────────────────────────────────
let inbuf = "";
process.stdin.on("data", (chunk) => {
	inbuf += chunk.toString("utf8");
	for (;;) {
		const nl = inbuf.indexOf("\n");
		if (nl < 0) break;
		const line = inbuf.slice(0, nl);
		inbuf = inbuf.slice(nl + 1);
		if (!line.trim()) continue;
		let msg;
		try { msg = JSON.parse(line); } catch (err) { logAction("warn", `bad JSON on stdin: ${err.message}`); continue; }
		if (msg.type !== "invoke") continue;
		handleInvoke(msg).catch((err) => {
			send({ type: "invoke-response", requestId: msg.requestId, success: false, error: String(err?.message ?? err) });
		});
	}
});

async function handleInvoke(msg) {
	switch (msg.method) {
		case "status": {
			send({ type: "invoke-response", requestId: msg.requestId, success: true, payload: statusSnapshot() });
			return;
		}
		case "prepare": {
			const force = Boolean(msg.params && typeof msg.params === "object" && msg.params.force);
			const result = await prepareModels(force);
			send({ type: "invoke-response", requestId: msg.requestId, success: true, payload: result });
			return;
		}
		case "synthesize": {
			// Auto-prepare if models are missing — keeps the first
			// synthesize call self-healing instead of erroring once.
			const snap = statusSnapshot();
			if (!snap.modelsExist) {
				logAction("info", "models missing — auto-preparing before first synthesize");
				await prepareModels(false);
			}
			const result = await synthesizeOnce(msg.params ?? {});
			const buf = await readFile(result.wavPath);
			await unlink(result.wavPath).catch(() => {});
			send({
				type: "invoke-response",
				requestId: msg.requestId,
				success: true,
				payload: { base64: buf.toString("base64"), mimeType: "audio/wav", byteLength: buf.length },
			});
			return;
		}
		default:
			send({ type: "invoke-response", requestId: msg.requestId, success: false, error: `unknown method: ${msg.method}` });
	}
}

void existsSync;
