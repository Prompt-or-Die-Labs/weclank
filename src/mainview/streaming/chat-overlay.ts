// In-stream Twitch chat overlay. Composited on top of the participant tiles
// inside StreamEngine's draw loop, so the overlay reaches the broadcast
// only — the local preview tiles are independent DOM elements.
//
// We hold a fixed-size ring of recent ChatMessages plus a few drawing
// constants. Twitch's per-user color comes through as the `color` tag
// when available; missing → derived from a hash of the username so two
// users don't share the same color very often.

import type { ChatMessage, ChatSource } from "../banter/chat-source";
import { TwitchChatSource } from "../banter/twitch-chat";
import type { ChatOverlayConfig, ChatOverlayPosition } from "../core/types";

const PADDING = 32;
const PANEL_PADDING = 14;
const LINE_HEIGHT = 28;
const HEADER_HEIGHT = 24;
const FONT = '500 16px -apple-system, "Inter", system-ui, sans-serif';
const HEADER_FONT = '600 12px -apple-system, "Inter", system-ui, sans-serif';

class ChatOverlay {
	private source: ChatSource | null = null;
	private config: ChatOverlayConfig | null = null;
	private messages: ChatMessage[] = [];

	start(config: ChatOverlayConfig): void {
		// Idempotent: same channel + enabled = no-op. Different channel =
		// reconnect.
		const changedChannel = !this.config || this.config.channel !== config.channel;
		this.config = config;
		if (!config.enabled || !config.channel) {
			this.stop();
			return;
		}
		if (!this.source || changedChannel) {
			this.source?.disconnect();
			this.messages = [];
			this.source = new TwitchChatSource(config.channel);
			this.source.connect().catch((err) => {
				console.warn("[chat-overlay] failed to connect", err);
				this.source = null;
			});
			void this.consume();
		}
	}

	stop(): void {
		this.source?.disconnect();
		this.source = null;
		this.messages = [];
	}

	updatePosition(position: ChatOverlayPosition): void {
		if (this.config) this.config.position = position;
	}

	/** Read-only access to the current message ring. Used by the Chat tab
	 * in the right sidebar to render live messages. Returns a shallow copy
	 * so the caller can't accidentally mutate the internal buffer. */
	getMessages(): ChatMessage[] {
		return this.messages.slice();
	}

	/** True when a Twitch source is connected (regardless of whether
	 * messages have arrived). */
	isConnected(): boolean {
		return this.source !== null;
	}

	getConfig(): ChatOverlayConfig | null {
		return this.config;
	}

	/** Push a synthetic message into the overlay (local chat-input panel).
	 * Works even when no Twitch source is connected — useful for testing. */
	inject(msg: ChatMessage): void {
		this.messages.push(msg);
		const cap = this.config?.maxMessages ?? 6;
		if (this.messages.length > cap) this.messages = this.messages.slice(-cap);
	}

	private async consume(): Promise<void> {
		const source = this.source;
		if (!source) return;
		for await (const msg of source.messages()) {
			if (this.source !== source) break; // we reconnected elsewhere
			this.messages.push(msg);
			const cap = this.config?.maxMessages ?? 6;
			if (this.messages.length > cap) this.messages = this.messages.slice(-cap);
		}
	}

	/** Called by StreamEngine each composite frame. Bail fast when off so
	 * we don't pay for measureText on idle frames. */
	draw(ctx: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number): void {
		const config = this.config;
		if (!config?.enabled || !config.channel) return;
		if (this.messages.length === 0) return;

		const panelWidth = Math.min(560, Math.max(320, canvasWidth * 0.32));
		const visible = this.messages.slice(-config.maxMessages);
		const panelHeight = HEADER_HEIGHT + visible.length * LINE_HEIGHT + PANEL_PADDING * 2;

		const { x, y } = panelOrigin(config.position, canvasWidth, canvasHeight, panelWidth, panelHeight);

		// Panel background
		ctx.save();
		ctx.fillStyle = "rgba(10, 10, 12, 0.72)";
		ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
		ctx.lineWidth = 1;
		roundRect(ctx, x, y, panelWidth, panelHeight, 10);
		ctx.fill();
		ctx.stroke();

		// Header
		ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
		ctx.font = HEADER_FONT;
		ctx.textAlign = "left";
		ctx.textBaseline = "top";
		ctx.fillText(`#${config.channel} · LIVE CHAT`, x + PANEL_PADDING, y + PANEL_PADDING);

		// Messages
		ctx.font = FONT;
		let lineY = y + PANEL_PADDING + HEADER_HEIGHT;
		const contentX = x + PANEL_PADDING;
		const contentMaxWidth = panelWidth - PANEL_PADDING * 2;
		for (const msg of visible) {
			drawChatLine(ctx, msg, contentX, lineY, contentMaxWidth);
			lineY += LINE_HEIGHT;
		}
		ctx.restore();
	}
}

function panelOrigin(
	position: ChatOverlayPosition,
	canvasW: number,
	canvasH: number,
	panelW: number,
	panelH: number,
): { x: number; y: number } {
	switch (position) {
		case "top-left":     return { x: PADDING, y: PADDING };
		case "top-right":    return { x: canvasW - panelW - PADDING, y: PADDING };
		case "bottom-right": return { x: canvasW - panelW - PADDING, y: canvasH - panelH - PADDING };
		case "bottom-left":
		default:             return { x: PADDING, y: canvasH - panelH - PADDING };
	}
}

function drawChatLine(
	ctx: CanvasRenderingContext2D,
	msg: ChatMessage,
	x: number,
	y: number,
	maxWidth: number,
): void {
	const username = `${msg.author}:`;
	const color = msg.meta?.["color"] || hashColor(msg.author);

	ctx.fillStyle = color;
	const usernameWidth = ctx.measureText(username).width;
	ctx.fillText(username, x, y);

	ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
	const textX = x + usernameWidth + 8;
	const textMaxWidth = maxWidth - usernameWidth - 8;
	ctx.fillText(truncateToFit(ctx, msg.text, textMaxWidth), textX, y);
}

function truncateToFit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
	if (ctx.measureText(text).width <= maxWidth) return text;
	const ellipsis = "…";
	let lo = 0;
	let hi = text.length;
	while (lo < hi) {
		const mid = Math.floor((lo + hi + 1) / 2);
		const candidate = text.slice(0, mid) + ellipsis;
		if (ctx.measureText(candidate).width <= maxWidth) lo = mid;
		else hi = mid - 1;
	}
	return text.slice(0, lo) + ellipsis;
}

function hashColor(name: string): string {
	let h = 0;
	for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
	const hue = Math.abs(h) % 360;
	return `hsl(${hue}, 65%, 65%)`;
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

export const chatOverlay = new ChatOverlay();
