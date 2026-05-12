#!/usr/bin/env bun
/**
 * CI-only: after merges to `main`, create and push the next `v*` semver tag so
 * `.github/workflows/release.yml` runs. Version bump is derived from the last
 * tag and commit subjects since then (conventional-commit style).
 *
 * Skips when: not in GitHub Actions, HEAD already equals last tag, no new
 * commits since last tag, or DRY_RUN=1.
 *
 * Override bump: set BUMP=major|minor|patch (CI secret or env) to force.
 */
import { spawnSync } from "node:child_process";

function git(args: string[]): { ok: boolean; out: string } {
	const r = spawnSync("git", args, { encoding: "utf-8" });
	const ok = r.status === 0;
	return { ok, out: (r.stdout ?? "").trimEnd() };
}

function lineImpliesMajor(s: string): boolean {
	if (/BREAKING CHANGE/i.test(s)) return true;
	return /^[a-z]+(?:\([^)]*\))?!:/i.test(s);
}

function lineImpliesMinor(s: string): boolean {
	return /^feat(?:\([^)]*\))?:/i.test(s);
}

function classifyBump(subjects: string[]): "major" | "minor" | "patch" {
	const forced = process.env.BUMP?.toLowerCase();
	if (forced === "major" || forced === "minor" || forced === "patch") return forced;
	for (const s of subjects) {
		if (lineImpliesMajor(s)) return "major";
	}
	for (const s of subjects) {
		if (lineImpliesMinor(s)) return "minor";
	}
	return "patch";
}

function parseSemver(tag: string): { major: number; minor: number; patch: number } | null {
	const m = /^v(\d+)\.(\d+)\.(\d+)/.exec(tag);
	if (!m) return null;
	return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

function formatSemver(v: { major: number; minor: number; patch: number }): string {
	return `${v.major}.${v.minor}.${v.patch}`;
}

function bump(
	v: { major: number; minor: number; patch: number },
	kind: "major" | "minor" | "patch",
): { major: number; minor: number; patch: number } {
	if (kind === "major") return { major: v.major + 1, minor: 0, patch: 0 };
	if (kind === "minor") return { major: v.major, minor: v.minor + 1, patch: 0 };
	return { major: v.major, minor: v.minor, patch: v.patch + 1 };
}

function remoteHasTag(tag: string): boolean {
	const { ok, out } = git(["ls-remote", "--tags", "origin", tag]);
	if (!ok) return false;
	return out.includes(`refs/tags/${tag}`);
}

const isCi = process.env.GITHUB_ACTIONS === "true";
const dry = process.env.DRY_RUN === "1";

if (!isCi && !dry) {
	console.log("auto-release-tag: skipping (set GITHUB_ACTIONS=true or DRY_RUN=1)");
	process.exit(0);
}

git(["fetch", "--tags", "origin"]);

const tags = git(["tag", "-l", "v*", "--sort=-v:refname"]);
const tagLines = tags.out.split("\n").map((l) => l.trim()).filter(Boolean);
const lastTag = tagLines[0];

const head = git(["rev-parse", "HEAD"]).out.trim();
if (lastTag) {
	const tagCommit = git(["rev-parse", `${lastTag}^{}`]).out.trim();
	if (head === tagCommit) {
		console.log(`auto-release-tag: HEAD is already at ${lastTag}; nothing to release.`);
		process.exit(0);
	}
}

const range = lastTag ? `${lastTag}..HEAD` : "HEAD";
const log = git(["log", range, "--format=%s"]);
if (!log.ok) {
	console.error("auto-release-tag: git log failed");
	process.exit(1);
}
const subjects = log.out.split("\n").map((l) => l.trim()).filter(Boolean);
if (lastTag && subjects.length === 0) {
	console.log("auto-release-tag: no commits since last tag; skip.");
	process.exit(0);
}

let base: { major: number; minor: number; patch: number };
if (lastTag) {
	const p = parseSemver(lastTag);
	if (!p) {
		console.error(`auto-release-tag: could not parse semver from ${lastTag}`);
		process.exit(1);
	}
	base = p;
} else {
	const pkg = JSON.parse(await Bun.file(new URL("../package.json", import.meta.url)).text()) as {
		version: string;
	};
	const p = parseSemver(`v${pkg.version}`);
	if (!p) {
		console.error("auto-release-tag: package.json version is not semver x.y.z");
		process.exit(1);
	}
	base = p;
}

let tag: string;
if (lastTag) {
	const kind = classifyBump(subjects);
	const next = bump(base, kind);
	tag = `v${formatSemver(next)}`;
	console.log(`auto-release-tag: since ${lastTag}, bump ${kind} -> ${tag}`);
} else {
	const forced = process.env.BUMP?.toLowerCase();
	if (forced === "major" || forced === "minor" || forced === "patch") {
		tag = `v${formatSemver(bump(base, forced))}`;
		console.log(`auto-release-tag: no prior tags; forced ${forced} -> ${tag}`);
	} else {
		tag = `v${formatSemver(base)}`;
		console.log(`auto-release-tag: no prior tags; using package.json baseline ${tag}`);
	}
}

let guard = 0;
while (remoteHasTag(tag) && guard < 32) {
	const prev = tag;
	const v = parseSemver(tag);
	if (!v) break;
	tag = `v${formatSemver(bump(v, "patch"))}`;
	guard += 1;
	console.log(`auto-release-tag: ${prev} already on remote; bump patch -> ${tag}`);
}
if (guard >= 32) {
	console.error("auto-release-tag: could not find unused tag");
	process.exit(1);
}

if (dry) {
	console.log(`auto-release-tag: DRY_RUN would create tag ${tag}`);
	process.exit(0);
}

const anno = spawnSync("git", ["tag", "-a", tag, "-m", `release ${tag}`], { stdio: "inherit" });
if (anno.status !== 0) {
	console.error("auto-release-tag: git tag failed");
	process.exit(1);
}

const push = spawnSync("git", ["push", "origin", tag], { stdio: "inherit" });
if (push.status !== 0) {
	console.error("auto-release-tag: git push failed");
	process.exit(1);
}

console.log(`auto-release-tag: pushed ${tag}`);
