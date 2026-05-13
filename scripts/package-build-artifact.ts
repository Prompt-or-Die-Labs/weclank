#!/usr/bin/env bun
/**
 * Archive the newest `build/canary-*` directory to `weclank-<tag>-<suffix>.tar.gz` at repo root.
 * Uses `tar` (available on GitHub-hosted macOS, Linux, and Windows runners).
 */
import { spawnSync } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const tag = process.argv[2];
const suffix = process.argv[3];
if (!tag || !suffix) {
	console.error("usage: package-build-artifact.ts <tag e.g. v0.3.0> <suffix e.g. macos-arm64>");
	process.exit(1);
}

const buildDir = "build";
const entries = await readdir(buildDir).catch(() => [] as string[]);
let best: string | undefined;
let bestM = 0;
for (const name of entries) {
	if (!name.startsWith("canary-")) continue;
	const p = join(buildDir, name);
	const s = await stat(p);
	if (s.isDirectory() && s.mtimeMs >= bestM) {
		bestM = s.mtimeMs;
		best = name;
	}
}
if (!best) {
	console.error("package-build-artifact: no build/canary-* directory found");
	process.exit(1);
}

const out = join(process.cwd(), `weclank-${tag}-${suffix}.tar.gz`);
const tar = spawnSync("tar", ["-czf", out, "-C", buildDir, best], { stdio: "inherit" });
if (tar.status !== 0) {
	console.error("package-build-artifact: tar failed");
	process.exit(1);
}
console.log(out);
