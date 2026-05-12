// Live captions overlay. Subscribes to the mic transcriber and renders
// the last few utterances near the bottom of the stream canvas. Toggled
// on/off via the tool-rail Captions item.
//
// Visually: a centered bottom band, mono font, hairline-bordered. Each
// new utterance appears, sits for `LINGER_MS`, then fades away. Multiple
// lines stack so a fast talker isn't truncated.

import { micTranscriber } from "../transcription/mic-transcriber";

interface CaptionLine {
	text: string;
	at: number;
}

const LINGER_MS = 8_000;
const MAX_LINES = 3;
const PADDING_BOTTOM = 96;

let enabled = false;
let unsubscribe: (() => void) | null = null;
const lines: CaptionLine[] = [];

export function isCaptionsEnabled(): boolean {
	return enabled;
}

export function setCaptionsEnabled(next: boolean): void {
	enabled = next;
	if (next) {
		if (!unsubscribe) {
			unsubscribe = micTranscriber.subscribe((text) => {
				lines.push({ text, at: Date.now() });
				if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
			});
		}
	} else {
		unsubscribe?.();
		unsubscribe = null;
		lines.length = 0;
	}
}

export function drawCaptions(ctx: CanvasRenderingContext2D, w: number, h: number): void {
	if (!enabled || lines.length === 0) return;
	const now = Date.now();
	// Prune expired in-place.
	while (lines.length > 0 && now - lines[0]!.at > LINGER_MS) lines.shift();
	if (lines.length === 0) return;

	ctx.save();
	ctx.font = '500 22px "JetBrains Mono", ui-monospace, monospace';
	ctx.textAlign = "center";
	ctx.textBaseline = "bottom";

	const lineHeight = 32;
	const maxWidth = Math.min(960, w * 0.7);
	const layout: string[] = [];
	for (const line of lines) layout.push(...wrap(ctx, line.text, maxWidth));
	const trimmed = layout.slice(-MAX_LINES);

	const blockHeight = trimmed.length * lineHeight + 24;
	const blockY = h - PADDING_BOTTOM - blockHeight;
	const blockX = (w - maxWidth) / 2;

	// Hairline panel
	ctx.fillStyle = "rgba(0,0,0,0.78)";
	ctx.strokeStyle = "rgba(255,255,255,0.08)";
	ctx.lineWidth = 1;
	ctx.fillRect(blockX, blockY, maxWidth, blockHeight);
	ctx.strokeRect(blockX + 0.5, blockY + 0.5, maxWidth - 1, blockHeight - 1);

	ctx.fillStyle = "#fafafa";
	let cursorY = blockY + 12 + lineHeight;
	for (const line of trimmed) {
		ctx.fillText(line, w / 2, cursorY);
		cursorY += lineHeight;
	}
	ctx.restore();
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
	const words = text.split(/\s+/);
	const out: string[] = [];
	let current = "";
	for (const word of words) {
		const tentative = current ? `${current} ${word}` : word;
		if (ctx.measureText(tentative).width <= maxWidth) {
			current = tentative;
		} else {
			if (current) out.push(current);
			current = word;
		}
	}
	if (current) out.push(current);
	return out;
}
