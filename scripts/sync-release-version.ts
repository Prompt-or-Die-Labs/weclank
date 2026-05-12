#!/usr/bin/env bun
/**
 * Sets `package.json` version and `electrobun.config.ts` `app.version` from env `VERSION`
 * (semver string without leading `v`, e.g. `0.2.0`). Used by the release workflow after a `v*` tag push.
 */
const v = process.env.VERSION?.trim();
if (!v || !/^\d+\.\d+\.\d+/.test(v)) {
	console.error("sync-release-version: set VERSION to a semver like 0.2.0 (no leading v)");
	process.exit(1);
}

const pkgPath = new URL("../package.json", import.meta.url);
const cfgPath = new URL("../electrobun.config.ts", import.meta.url);

const pkgRaw = await Bun.file(pkgPath).text();
const pkg = JSON.parse(pkgRaw) as { version: string };
pkg.version = v;
await Bun.write(pkgPath, `${JSON.stringify(pkg, null, "\t")}\n`);

let cfg = await Bun.file(cfgPath).text();
const replaced = cfg.replace(/(app:\s*\{[\s\S]*?version:\s*")[^"]+(")/, `$1${v}$2`);
if (replaced === cfg) {
	console.error("sync-release-version: could not find app.version in electrobun.config.ts");
	process.exit(1);
}
cfg = replaced;
await Bun.write(cfgPath, cfg);

console.log(`sync-release-version: set version to ${v}`);
