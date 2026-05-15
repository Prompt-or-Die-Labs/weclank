#!/usr/bin/env bun
// build-omnivoice.mjs — clone ServeurpersoCom/omnivoice.cpp under
// ~/.weclank/local-inference/ and cmake-build the `omnivoice-tts` binary
// for the current platform. (Upstream renamed the binary from
// `llama-omnivoice-server` → `omnivoice-tts` and dropped the server
// flag set in favor of a stdin → one-shot WAV CLI.)
//
// Usage:
//   bun run build:omnivoice            # build for current platform
//   bun run build:omnivoice -- --clean # nuke build dir + rebuild
//   bun run build:omnivoice -- --dry-run
//
// Env knobs:
//   WECLANK_LOCAL_INFERENCE_DIR  override the root (default: ~/.weclank/local-inference)
//   OMNIVOICE_BACKEND            auto | metal | cuda | vulkan | cpu
//   OMNIVOICE_REF                git ref to checkout (default: master)
//   OMNIVOICE_JOBS               -j parallel jobs (default: cpu count)

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, cp, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import os from "node:os";

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const CLEAN = args.has("--clean");

const HOME = homedir();
const ROOT = process.env.WECLANK_LOCAL_INFERENCE_DIR ?? join(HOME, ".weclank", "local-inference");
const SRC_DIR = join(ROOT, "src", "omnivoice.cpp");
const BUILD_DIR = join(SRC_DIR, "build");
const BIN_DIR = join(ROOT, "bin");
const REF = process.env.OMNIVOICE_REF ?? "master";
const REPO = "https://github.com/ServeurpersoCom/omnivoice.cpp.git";

const BIN_NAME = process.platform === "win32" ? "omnivoice-tts.exe" : "omnivoice-tts";

function log(msg) { process.stdout.write(`[build-omnivoice] ${msg}\n`); }
function fail(msg) {
	process.stderr.write(`[build-omnivoice] error: ${msg}\n`);
	process.exit(1);
}

function detectBackend() {
	const explicit = process.env.OMNIVOICE_BACKEND?.toLowerCase();
	if (["metal", "cuda", "vulkan", "cpu"].includes(explicit ?? "")) return explicit;
	if (process.platform === "darwin") return "metal";
	for (const dir of (process.env.PATH ?? "").split(":")) {
		if (dir && existsSync(join(dir, "nvcc"))) return "cuda";
	}
	return "cpu";
}

function platformFlags(backend) {
	switch (backend) {
		case "metal":   return ["-DGGML_METAL=ON", "-DGGML_BLAS=OFF"];
		case "cuda":    return ["-DGGML_CUDA=ON", "-DGGML_NATIVE=ON"];
		case "vulkan":  return ["-DGGML_VULKAN=ON"];
		default:        return ["-DGGML_NATIVE=ON"];
	}
}

function run(cmd, cmdArgs, opts = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, cmdArgs, { cwd: opts.cwd ?? process.cwd(), stdio: "inherit", env: process.env });
		child.on("error", reject);
		child.on("exit", (code) => {
			if (code === 0) resolve();
			else reject(new Error(`${cmd} ${cmdArgs.join(" ")} exited code=${code ?? "null"}`));
		});
	});
}

async function ensureSource() {
	if (existsSync(SRC_DIR)) {
		log(`source present at ${SRC_DIR} — git fetch + checkout ${REF}`);
		if (DRY_RUN) return;
		await run("git", ["fetch", "--depth=1", "origin", REF], { cwd: SRC_DIR });
		await run("git", ["checkout", "-f", REF], { cwd: SRC_DIR });
		return;
	}
	await mkdir(dirname(SRC_DIR), { recursive: true });
	log(`cloning ${REPO} → ${SRC_DIR}`);
	if (DRY_RUN) return;
	await run("git", ["clone", "--depth=1", "--branch", REF, "--recurse-submodules", REPO, SRC_DIR]);
}

async function configureAndBuild(backend) {
	const jobs = process.env.OMNIVOICE_JOBS ?? String(os.cpus().length);
	const configureArgs = [
		"-S", SRC_DIR,
		"-B", BUILD_DIR,
		"-DCMAKE_BUILD_TYPE=Release",
		...platformFlags(backend),
	];
	log(`cmake ${configureArgs.join(" ")}`);
	if (!DRY_RUN) await run("cmake", configureArgs);

	// `omnivoice-tts` is the user-facing one-shot WAV synthesizer.
	// `omnivoice-codec` is built as a sibling so debug/voice-clone flows
	// have it available without a second cmake pass. `omnivoice-core` is
	// the shared library both depend on — cmake builds it transitively.
	const targets = ["omnivoice-tts", "omnivoice-codec"];
	for (const target of targets) {
		const buildArgs = ["--build", BUILD_DIR, "--target", target, "-j", jobs];
		log(`cmake ${buildArgs.join(" ")}`);
		if (!DRY_RUN) {
			try { await run("cmake", buildArgs); } catch (err) {
				if (target === "omnivoice-codec") {
					log(`warning: optional target '${target}' did not build (${err.message}) — continuing without the codec tool`);
					continue;
				}
				throw err;
			}
		}
	}
}

async function copyArtifacts() {
	await mkdir(BIN_DIR, { recursive: true });
	const found = [];
	async function walk(dir) {
		for (const entry of await readdir(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) await walk(full);
			else if (entry.isFile()) {
				if (entry.name === BIN_NAME) found.push({ src: full, dst: join(BIN_DIR, entry.name) });
				else if (entry.name === (process.platform === "win32" ? "omnivoice-codec.exe" : "omnivoice-codec")) {
					found.push({ src: full, dst: join(BIN_DIR, entry.name) });
				}
				else if (/^(libomnivoice|libggml)\.(dylib|so|dll)$/.test(entry.name)) {
					found.push({ src: full, dst: join(BIN_DIR, entry.name) });
				}
			}
		}
	}
	if (!DRY_RUN) await walk(BUILD_DIR);
	for (const { src, dst } of found) {
		log(`copy ${src} → ${dst}`);
		await cp(src, dst, { force: true });
	}
	if (!found.some((f) => f.dst.endsWith(BIN_NAME))) {
		throw new Error(
			`Build completed but ${BIN_NAME} was not found under ${BUILD_DIR}. ` +
			`Inspect the build dir or pass OMNIVOICE_BACKEND= to retry with a different backend.`,
		);
	}
}

async function main() {
	const backend = detectBackend();
	log(`platform=${process.platform}/${process.arch}, backend=${backend}, ref=${REF}`);
	log(`root=${ROOT}`);
	if (CLEAN) {
		log("--clean: removing build dir");
		if (!DRY_RUN) await rm(BUILD_DIR, { recursive: true, force: true });
	}
	await ensureSource();
	await configureAndBuild(backend);
	await copyArtifacts();
	log(`done. Binary at ${join(BIN_DIR, BIN_NAME)}`);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
