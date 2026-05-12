// In-stream graphics overlays — title cards, lower-thirds, code snippets,
// transient notices. Rendered onto the StreamEngine canvas after the
// participant tiles + chat overlay so they always sit on top.
//
// The registry is canvas-only state (with a backup mirror in studio state
// for persistence). Anyone — manual UI, banter agent tool, future scene
// hotkeys — calls `streamOverlays.add(...)` and it Just Renders.

import { studio } from "../state/studio-store";
import type { OverlayId } from "../core/ids";
import type { OverlayPosition, StreamOverlay, StreamOverlayProps } from "../core/types";

/** Hard cap on simultaneous overlays. If the LLM goes feral and keeps
 * adding without removing, the oldest auto-expiring one drops off so
 * the broadcast doesn't become a wall of overlay panels. Sticky
 * overlays — those without an expiresAt — are immune (the user
 * presumably wants them up). */
const MAX_OVERLAYS = 12;
const imageCache = new Map<string, HTMLImageElement>();

class StreamOverlayRegistry {
	add(overlay: StreamOverlay): StreamOverlay {
		const current = studio.state.streamOverlays;
		// Skip the cap when re-upserting an existing id (caller is
		// updating, not adding net-new).
		const exists = current.some((o) => o.id === overlay.id);
		if (!exists && current.length >= MAX_OVERLAYS) {
			const dropable = current
				.filter((o) => o.expiresAt != null)
				.sort((a, b) => a.createdAt - b.createdAt)[0];
			if (dropable) studio.removeStreamOverlay(dropable.id);
			else {
				console.warn("[overlays] cap reached and all are sticky — skipping add");
				return overlay;
			}
		}
		studio.upsertStreamOverlay(overlay);
		return overlay;
	}

	update(id: OverlayId, props: Partial<StreamOverlayProps>): StreamOverlay | null {
		const existing = studio.state.streamOverlays.find((o) => o.id === id);
		if (!existing) return null;
		const updated = { ...existing, props: { ...existing.props, ...props } };
		studio.upsertStreamOverlay(updated);
		return updated;
	}

	remove(id: OverlayId): boolean {
		imageCache.delete(id);
		return studio.removeStreamOverlay(id);
	}

	clear(): void {
		imageCache.clear();
		studio.clearStreamOverlays();
	}

	all(): StreamOverlay[] {
		return studio.state.streamOverlays;
	}

	/** Tick: drop overlays whose expiry passed. Stream engine calls this
	 * once per composite. Cheap: O(n) over a tiny n. */
	tick(now: number): void {
		const expired = studio.state.streamOverlays.filter((o) => o.expiresAt && o.expiresAt <= now);
		for (const o of expired) this.remove(o.id);
	}
}

export const streamOverlays = new StreamOverlayRegistry();

const PADDING = 32;
const ACCENT = "#fafafa";

export function drawStreamOverlays(ctx: CanvasRenderingContext2D, w: number, h: number): void {
	streamOverlays.tick(Date.now());
	for (const overlay of streamOverlays.all()) {
		try {
			drawOverlay(ctx, overlay, w, h);
		} catch (err) {
			console.warn("[overlays] draw failed", overlay, err);
		}
	}
}

function drawOverlay(ctx: CanvasRenderingContext2D, overlay: StreamOverlay, w: number, h: number): void {
	switch (overlay.kind) {
		case "title-card":
			drawTitleCard(ctx, overlay, w, h);
			break;
		case "notice":
			drawNotice(ctx, overlay, w, h);
			break;
		case "code-snippet":
			drawCodeSnippet(ctx, overlay, w, h);
			break;
		case "lower-third":
			drawLowerThird(ctx, overlay, w, h);
			break;
		case "qr-code":
			drawQrCode(ctx, overlay, w, h);
			break;
	}
}

function placeAt(position: OverlayPosition, w: number, h: number, panelW: number, panelH: number): { x: number; y: number } {
	switch (position) {
		case "top-left":     return { x: PADDING, y: PADDING };
		case "top-right":    return { x: w - panelW - PADDING, y: PADDING };
		case "bottom-right": return { x: w - panelW - PADDING, y: h - panelH - PADDING };
		case "center":       return { x: (w - panelW) / 2, y: (h - panelH) / 2 };
		case "lower-third":  return { x: PADDING, y: h - panelH - PADDING * 2 };
		case "bottom-left":
		default:             return { x: PADDING, y: h - panelH - PADDING };
	}
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
	const words = text.split(/\s+/);
	const lines: string[] = [];
	let current = "";
	for (const word of words) {
		const tentative = current ? `${current} ${word}` : word;
		if (ctx.measureText(tentative).width <= maxWidth) {
			current = tentative;
		} else {
			if (current) lines.push(current);
			current = word;
			if (lines.length >= maxLines) break;
		}
	}
	if (current && lines.length < maxLines) lines.push(current);
	return lines;
}

function drawTitleCard(ctx: CanvasRenderingContext2D, overlay: StreamOverlay, w: number, h: number): void {
	const accent = overlay.props.accentColor ?? ACCENT;
	const panelW = Math.min(720, w * 0.6);
	ctx.save();
	ctx.font = '600 36px -apple-system, "Inter", system-ui';
	const titleLines = overlay.props.title ? wrap(ctx, overlay.props.title, panelW - 64, 2) : [];
	ctx.font = '500 18px -apple-system, "Inter", system-ui';
	const subLines = overlay.props.subtitle ? wrap(ctx, overlay.props.subtitle, panelW - 64, 2) : [];
	const panelH = 48 + titleLines.length * 44 + (subLines.length ? 16 + subLines.length * 24 : 0);
	const { x, y } = placeAt(overlay.position, w, h, panelW, panelH);

	ctx.fillStyle = "rgba(10, 10, 12, 0.85)";
	ctx.strokeStyle = "rgba(255,255,255,0.06)";
	roundRect(ctx, x, y, panelW, panelH, 14);
	ctx.fill();
	ctx.stroke();
	ctx.fillStyle = accent;
	ctx.fillRect(x, y, 4, panelH);

	let cursorY = y + 32;
	ctx.fillStyle = "#fff";
	ctx.textBaseline = "top";
	ctx.font = '600 36px -apple-system, "Inter", system-ui';
	for (const line of titleLines) {
		ctx.fillText(line, x + 32, cursorY);
		cursorY += 44;
	}
	if (subLines.length) {
		cursorY += 8;
		ctx.fillStyle = "rgba(255,255,255,0.65)";
		ctx.font = '500 18px -apple-system, "Inter", system-ui';
		for (const line of subLines) {
			ctx.fillText(line, x + 32, cursorY);
			cursorY += 24;
		}
	}
	ctx.restore();
}

function drawNotice(ctx: CanvasRenderingContext2D, overlay: StreamOverlay, w: number, h: number): void {
	const accent = overlay.props.accentColor ?? ACCENT;
	const text = overlay.props.body ?? overlay.props.title ?? "";
	if (!text) return;
	const panelW = Math.min(420, w * 0.32);
	ctx.save();
	ctx.font = '500 16px -apple-system, "Inter", system-ui';
	const lines = wrap(ctx, text, panelW - 32, 3);
	const panelH = 16 + lines.length * 22 + 16;
	const { x, y } = placeAt(overlay.position, w, h, panelW, panelH);

	// Fade-in animation: opacity ramps over 250ms after createdAt
	const ageMs = Date.now() - overlay.createdAt;
	const alpha = Math.min(1, ageMs / 250);
	ctx.globalAlpha = alpha;
	ctx.fillStyle = "rgba(10, 10, 12, 0.85)";
	roundRect(ctx, x, y, panelW, panelH, 10);
	ctx.fill();
	ctx.fillStyle = accent;
	ctx.fillRect(x, y, 3, panelH);

	let cursorY = y + 16;
	ctx.fillStyle = "rgba(255,255,255,0.95)";
	ctx.textBaseline = "top";
	for (const line of lines) {
		ctx.fillText(line, x + 16, cursorY);
		cursorY += 22;
	}
	ctx.restore();
}

function drawCodeSnippet(ctx: CanvasRenderingContext2D, overlay: StreamOverlay, w: number, h: number): void {
	const body = overlay.props.body ?? "";
	if (!body) return;
	const panelW = Math.min(820, w * 0.7);
	ctx.save();
	ctx.font = '500 14px "SF Mono", "JetBrains Mono", ui-monospace, Menlo, monospace';
	const lines = body.split("\n");
	const truncated = lines.slice(0, 24);
	const lineHeight = 20;
	const headerH = overlay.props.title || overlay.props.language ? 28 : 0;
	const panelH = 24 + headerH + truncated.length * lineHeight + 24;
	const { x, y } = placeAt(overlay.position, w, h, panelW, panelH);

	ctx.fillStyle = "rgba(10, 10, 14, 0.92)";
	ctx.strokeStyle = "rgba(255,255,255,0.05)";
	roundRect(ctx, x, y, panelW, panelH, 10);
	ctx.fill();
	ctx.stroke();

	if (headerH) {
		ctx.fillStyle = "rgba(255,255,255,0.55)";
		ctx.font = '600 12px -apple-system, "Inter", system-ui';
		ctx.textBaseline = "top";
		const label = [overlay.props.title, overlay.props.language].filter(Boolean).join(" · ");
		ctx.fillText(label, x + 20, y + 12);
	}

	ctx.font = '500 14px "SF Mono", "JetBrains Mono", ui-monospace, Menlo, monospace';
	ctx.fillStyle = "rgba(220,220,230,0.95)";
	let cursorY = y + 12 + headerH + (headerH ? 8 : 12);
	for (const line of truncated) {
		ctx.fillText(line.length > 96 ? line.slice(0, 96) + "…" : line, x + 20, cursorY);
		cursorY += lineHeight;
	}
	ctx.restore();
}

function drawLowerThird(ctx: CanvasRenderingContext2D, overlay: StreamOverlay, w: number, h: number): void {
	const title = overlay.props.title ?? "";
	const subtitle = overlay.props.subtitle ?? "";
	if (!title && !subtitle) return;
	ctx.save();
	const padX = 16;
	ctx.font = '700 22px -apple-system, "Inter", system-ui';
	const titleW = ctx.measureText(title).width;
	ctx.font = '500 16px "SF Mono", ui-monospace, Menlo, monospace';
	const subW = ctx.measureText(subtitle).width;
	const panelW = Math.max(titleW, subW) + padX * 2;
	const panelH = 32 + (subtitle ? 28 : 0);
	const { x, y } = placeAt(overlay.position === "bottom-left" ? "lower-third" : overlay.position, w, h, panelW, panelH);

	if (title) {
		ctx.fillStyle = "#f08a3a";
		ctx.fillRect(x, y, titleW + padX * 2, 32);
		ctx.fillStyle = "#1a1100";
		ctx.font = '700 22px -apple-system, "Inter", system-ui';
		ctx.textBaseline = "middle";
		ctx.fillText(title, x + padX, y + 16);
	}
	if (subtitle) {
		ctx.fillStyle = "#fff";
		ctx.fillRect(x, y + 32, subW + padX * 2, 28);
		ctx.fillStyle = "#111";
		ctx.font = '500 16px "SF Mono", ui-monospace, Menlo, monospace';
		ctx.textBaseline = "middle";
		ctx.fillText(subtitle, x + padX, y + 32 + 14);
	}
	ctx.restore();
}

function drawQrCode(ctx: CanvasRenderingContext2D, overlay: StreamOverlay, w: number, h: number): void {
	const src = overlay.props.imageUrl;
	if (!src) return;
	const panelW = 230;
	const panelH = overlay.props.title ? 274 : 230;
	const { x, y } = placeAt(overlay.position, w, h, panelW, panelH);
	const image = imageForOverlay(overlay.id, src);

	ctx.save();
	ctx.fillStyle = "rgba(250,250,250,0.96)";
	roundRect(ctx, x, y, panelW, panelH, 12);
	ctx.fill();

	if (image.complete && image.naturalWidth > 0) {
		ctx.drawImage(image, x + 15, y + 15, 200, 200);
	}

	if (overlay.props.title) {
		ctx.fillStyle = "#111";
		ctx.font = '700 16px -apple-system, "Inter", system-ui';
		ctx.textBaseline = "top";
		const lines = wrap(ctx, overlay.props.title, panelW - 24, 2);
		let cursorY = y + 224;
		for (const line of lines) {
			ctx.fillText(line, x + 12, cursorY);
			cursorY += 20;
		}
	}
	ctx.restore();
}

function imageForOverlay(id: OverlayId, src: string): HTMLImageElement {
	const cached = imageCache.get(id);
	if (cached?.src === src) return cached;
	const image = new Image();
	image.src = src;
	imageCache.set(id, image);
	return image;
}
