import { chatOverlay } from "./chat-overlay";
import { drawCaptions } from "./captions-overlay";
import { drawStreamOverlays } from "./stream-overlays";

interface OverlayLayer {
	draw(ctx: CanvasRenderingContext2D, width: number, height: number): void;
}

const layers: OverlayLayer[] = [
	{ draw: (ctx, width, height) => chatOverlay.draw(ctx, width, height) },
	{ draw: drawStreamOverlays },
	{ draw: drawCaptions },
];

export function drawBroadcastOverlayPlane(ctx: CanvasRenderingContext2D, width: number, height: number): void {
	for (const layer of layers) layer.draw(ctx, width, height);
}
