#!/usr/bin/env bun
/**
 * Sets the release version across the three places that carry it:
 *   - package.json `version`
 *   - src/mainview/product.ts `PRODUCT_VERSION` (the build-time constant
 *     electrobun.config.ts imports for `app.version`)
 *
 * Reads `VERSION` from env. Accepts a leading `v` (e.g. `v0.7.0`) and
 * strips it. Used by .github/workflows/release.yml after a tag push or
 * a workflow_dispatch with the tag input set.
 */
const raw = process.env.VERSION?.trim() ?? "";
const v = raw.replace(/^v/, "");
if (!/^\d+\.\d+\.\d+/.test(v)) {
	console.error("sync-release-version: set VERSION to a semver like 0.2.0 or v0.2.0");
	process.exit(1);
}

const pkgPath = new URL("../package.json", import.meta.url);
const productPath = new URL("../src/mainview/product.ts", import.meta.url);

const pkgRaw = await Bun.file(pkgPath).text();
const pkg = JSON.parse(pkgRaw) as { version: string };
pkg.version = v;
await Bun.write(pkgPath, `${JSON.stringify(pkg, null, "\t")}\n`);

const productRaw = await Bun.file(productPath).text();
const productReplaced = productRaw.replace(
	/(export const PRODUCT_VERSION\s*=\s*")[^"]+(")/,
	`$1${v}$2`,
);
if (productReplaced === productRaw) {
	console.error("sync-release-version: could not find PRODUCT_VERSION in src/mainview/product.ts");
	process.exit(1);
}
await Bun.write(productPath, productReplaced);

console.log(`sync-release-version: set version to ${v}`);
