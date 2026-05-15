// Broadcast overlay plane — the ordered graphics pass drawn on top of
// participant tiles before capture. Per CONTEXT.md, this is one concept;
// every overlay system (chat panel, generated overlays, captions, future
// recording timer, viewer-count chip, etc.) registers itself here as an
// OverlaySource and the plane handles z-ordering + the draw loop.
//
// Built-in sources (chat / stream-overlays / captions) self-register at
// module load so the existing call sites in stream-engine.ts continue
// to work with no extra wiring.

import { chatOverlay } from "./chat-overlay";
import { drawCaptions } from "./captions-overlay";
import { drawStreamOverlays } from "./stream-overlays";

export interface OverlaySource {
	/** Stable id — same source can re-register to update its draw fn. */
	readonly id: string;
	/** Smaller z-index draws first (further from viewer). Defaults to 0. */
	readonly zIndex?: number;
	/** Called once per composited frame. The plane saves/restores the
	 * canvas state around this call so a source can mutate the ctx freely. */
	draw(ctx: CanvasRenderingContext2D, width: number, height: number): void;
}

interface InternalSource extends OverlaySource {
	zIndex: number;
	sortKey: number;
}

class BroadcastOverlayPlane {
	private sources: InternalSource[] = [];
	private nextSeq = 0;
	private dirty = false;

	register(source: OverlaySource): void {
		const existingIdx = this.sources.findIndex((s) => s.id === source.id);
		const entry: InternalSource = {
			id: source.id,
			zIndex: source.zIndex ?? 0,
			draw: source.draw,
			sortKey: existingIdx >= 0 ? this.sources[existingIdx]!.sortKey : ++this.nextSeq,
		};
		if (existingIdx >= 0) this.sources[existingIdx] = entry;
		else this.sources.push(entry);
		this.dirty = true;
	}

	unregister(id: string): boolean {
		const before = this.sources.length;
		this.sources = this.sources.filter((s) => s.id !== id);
		return this.sources.length < before;
	}

	/** Currently-registered source ids in draw order (test surface). */
	ids(): string[] {
		this.sortIfDirty();
		return this.sources.map((s) => s.id);
	}

	draw(ctx: CanvasRenderingContext2D, width: number, height: number): void {
		this.sortIfDirty();
		for (const source of this.sources) {
			ctx.save();
			try {
				source.draw(ctx, width, height);
			} finally {
				ctx.restore();
			}
		}
	}

	/** Stable sort: by zIndex ASC, ties broken by registration order. */
	private sortIfDirty(): void {
		if (!this.dirty) return;
		this.sources.sort((a, b) => (a.zIndex - b.zIndex) || (a.sortKey - b.sortKey));
		this.dirty = false;
	}
}

export const broadcastOverlayPlane = new BroadcastOverlayPlane();

// ── Default sources ────────────────────────────────────────────────────
// z-order (small first, large last = closer to viewer):
//   0  generated stream overlays (title cards, lower thirds, code, QR)
//   10 chat panel (chrome that sits over the program but under captions)
//   20 captions (must always be readable; drawn last)
broadcastOverlayPlane.register({
	id: "stream-overlays",
	zIndex: 0,
	draw: (ctx, w, h) => drawStreamOverlays(ctx, w, h),
});
broadcastOverlayPlane.register({
	id: "chat-overlay",
	zIndex: 10,
	draw: (ctx, w, h) => chatOverlay.draw(ctx, w, h),
});
broadcastOverlayPlane.register({
	id: "captions",
	zIndex: 20,
	draw: (ctx, w, h) => drawCaptions(ctx, w, h),
});

/** Back-compat: stream-engine.ts calls this each frame. Kept as a thin
 * shim so the plane can stay a private singleton; the registry is the
 * interface for anyone who wants to register a NEW source. */
export function drawBroadcastOverlayPlane(
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
): void {
	broadcastOverlayPlane.draw(ctx, width, height);
}
