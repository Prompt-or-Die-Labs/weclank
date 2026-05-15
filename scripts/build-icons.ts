#!/usr/bin/env bun
/**
 * Build platform-native icon assets from the source SVGs at
 * `assets/icons/source/{appicon,trayicon}.svg`.
 *
 * Both SVGs are thin wrappers around a single high-res embedded PNG. We
 * pull the PNG out directly (no rasterizer needed), then use `sips`
 * (macOS-native) for resizing and `iconutil` for `.icns` packaging.
 *
 * Outputs:
 *   assets/icons/icon.iconset/   — macOS app icon (compiled to .icns at build)
 *   assets/icons/icon.png        — Linux app icon (512×512)
 *   assets/icons/icon.ico        — Windows app icon (16/32/48/256, PNG-embedded)
 *   assets/icons/trayicon.png    — macOS/Linux/Windows tray (64×64; rendered at 16pt)
 *
 * This script runs on macOS (sips + iconutil). The generated assets are
 * checked into the repo so cross-platform release builds can read them
 * without re-running the converter.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

const ROOT = new URL("../", import.meta.url).pathname;
const SRC_DIR = join(ROOT, "assets/icons/source");
const OUT_DIR = join(ROOT, "assets/icons");

function run(cmd: string, args: string[]): void {
	const r = spawnSync(cmd, args, { stdio: "inherit" });
	if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited ${r.status}`);
}

function extractPng(svgPath: string): Buffer {
	const svg = readFileSync(svgPath, "utf8");
	const m = svg.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/);
	if (!m) throw new Error(`no embedded PNG found in ${svgPath}`);
	return Buffer.from(m[1], "base64");
}

function resize(src: string, dst: string, size: number): void {
	mkdirSync(dirname(dst), { recursive: true });
	run("sips", ["-Z", String(size), "-s", "format", "png", src, "--out", dst]);
}

// Zoom the artwork inside the icon canvas by center-cropping the source
// PNG before downscaling. The user's source PNGs have a built-in border
// of empty/neutral pixels around the logo; cropping makes the visible
// glyph bigger in the rendered icon.
function centerCrop(src: string, dst: string, fraction: number): void {
	mkdirSync(dirname(dst), { recursive: true });
	// sips reads the input's pixel dimensions; we crop relative to those.
	const probe = spawnSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", src], { encoding: "utf-8" });
	const w = Number(probe.stdout.match(/pixelWidth:\s*(\d+)/)?.[1] ?? 0);
	const h = Number(probe.stdout.match(/pixelHeight:\s*(\d+)/)?.[1] ?? 0);
	if (!w || !h) throw new Error(`sips probe failed for ${src}`);
	const side = Math.floor(Math.min(w, h) * fraction);
	run("sips", ["-c", String(side), String(side), "-s", "format", "png", src, "--out", dst]);
}

// Multi-resolution .ico: header (6 bytes) + N directory entries (16 bytes
// each) + concatenated PNG data. Modern Windows accepts PNG-compressed
// entries — much simpler than packing 32-bit BMPs.
function buildIco(pngPaths: string[], outPath: string): void {
	const pngs = pngPaths.map((p) => readFileSync(p));
	const sizes = pngs.map((buf) => buf.readUInt32BE(16));
	const count = pngs.length;
	const headerLen = 6 + count * 16;
	let offset = headerLen;
	const header = Buffer.alloc(headerLen);
	header.writeUInt16LE(0, 0);  // reserved
	header.writeUInt16LE(1, 2);  // type 1 = icon
	header.writeUInt16LE(count, 4);
	for (let i = 0; i < count; i++) {
		const png = pngs[i];
		if (!png) throw new Error(`missing PNG buffer at index ${i}`);
		const size = sizes[i];
		if (size === undefined) throw new Error(`missing size for entry ${i}`);
		const base = 6 + i * 16;
		header.writeUInt8(size >= 256 ? 0 : size, base + 0);  // 0 = 256
		header.writeUInt8(size >= 256 ? 0 : size, base + 1);
		header.writeUInt8(0, base + 2);   // color palette
		header.writeUInt8(0, base + 3);   // reserved
		header.writeUInt16LE(1, base + 4);    // planes
		header.writeUInt16LE(32, base + 6);   // bit depth (advisory for PNG)
		header.writeUInt32LE(png.length, base + 8);
		header.writeUInt32LE(offset, base + 12);
		offset += png.length;
	}
	writeFileSync(outPath, Buffer.concat([header, ...pngs]));
}

// 1. Extract embedded PNGs (highest source resolution we have to work with).
const appPng = extractPng(join(SRC_DIR, "appicon.svg"));
const trayPng = extractPng(join(SRC_DIR, "trayicon.svg"));
const tmpDir = join(OUT_DIR, ".tmp");
if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
mkdirSync(tmpDir, { recursive: true });
const appPngFull = join(tmpDir, "app-full.png");
const trayPngFull = join(tmpDir, "tray-full.png");
writeFileSync(appPngFull, appPng);
writeFileSync(trayPngFull, trayPng);

// Center-crop the artwork before resizing so the glyph fills more of the
// rendered icon. 0.78 = keep the middle 78% of each axis (drops ~11% of
// padding off every side). Tweak here if the user wants more/less zoom.
const APP_CROP = 0.78;
const TRAY_CROP = 0.7;
const appPngTmp = join(tmpDir, "app-cropped.png");
const trayPngTmp = join(tmpDir, "tray-cropped.png");
centerCrop(appPngFull, appPngTmp, APP_CROP);
centerCrop(trayPngFull, trayPngTmp, TRAY_CROP);

// 2. macOS .iconset — the ten sizes Apple's iconutil expects.
const iconset = join(OUT_DIR, "icon.iconset");
if (existsSync(iconset)) rmSync(iconset, { recursive: true });
mkdirSync(iconset, { recursive: true });
const iconsetSizes: Array<{ name: string; size: number }> = [
	{ name: "icon_16x16.png", size: 16 },
	{ name: "icon_16x16@2x.png", size: 32 },
	{ name: "icon_32x32.png", size: 32 },
	{ name: "icon_32x32@2x.png", size: 64 },
	{ name: "icon_128x128.png", size: 128 },
	{ name: "icon_128x128@2x.png", size: 256 },
	{ name: "icon_256x256.png", size: 256 },
	{ name: "icon_256x256@2x.png", size: 512 },
	{ name: "icon_512x512.png", size: 512 },
	{ name: "icon_512x512@2x.png", size: 1024 },
];
for (const { name, size } of iconsetSizes) {
	resize(appPngTmp, join(iconset, name), size);
}
console.log(`✓ wrote ${iconset}/ (${iconsetSizes.length} sizes)`);

// 3. Linux app icon — single 512×512 PNG.
const linuxPng = join(OUT_DIR, "icon.png");
resize(appPngTmp, linuxPng, 512);
console.log(`✓ wrote ${linuxPng}`);

// 4. Windows .ico — pack 16, 32, 48, 256 PNG entries.
const icoSizes = [16, 32, 48, 256];
const icoPngs: string[] = [];
for (const size of icoSizes) {
	const p = join(tmpDir, `ico-${size}.png`);
	resize(appPngTmp, p, size);
	icoPngs.push(p);
}
const icoPath = join(OUT_DIR, "icon.ico");
buildIco(icoPngs, icoPath);
console.log(`✓ wrote ${icoPath} (sizes: ${icoSizes.join(", ")})`);

// 5. Tray icon — render at 88px (= 22pt @4× retina) so the menubar
// glyph has the same chunky presence as Discord/Slack/Linear, not
// the postage-stamp we got at the default 16pt size.
const trayOut = join(OUT_DIR, "trayicon.png");
resize(trayPngTmp, trayOut, 88);
console.log(`✓ wrote ${trayOut}`);

// 6. Cleanup.
rmSync(tmpDir, { recursive: true });
console.log("build-icons: done");
