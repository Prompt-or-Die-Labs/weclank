// In-stream multi-platform chat overlay. Composited on top of the
// participant tiles inside StreamEngine's draw loop, so the overlay
// reaches the broadcast only — the local preview tiles are independent
// DOM elements.
//
// Reads messages from ChatBus (one shared queue per renderer). The
// overlay just holds a small recent-message window and draws it. Bus
// synchronization (which connectors are running) happens in studio-store
// when state.overlays.chat changes.

import type { ChatMessage } from "../banter/chat-source";
import { chatBus } from "../chat/chat-bus";
import type { ChatOverlayConfig, ChatOverlayPosition } from "../core/types";

const PADDING = 32;
const PANEL_PADDING = 14;
const LINE_HEIGHT = 28;
const HEADER_HEIGHT = 24;
const FONT = '500 16px -apple-system, "Inter", system-ui, sans-serif';
const HEADER_FONT = '600 12px -apple-system, "Inter", system-ui, sans-serif';

class ChatOverlay {
	private config: ChatOverlayConfig | null = null;
	private messages: ChatMessage[] = [];
	private unsubscribe: (() => void) | null = null;

	start(config: ChatOverlayConfig): void {
		this.config = config;
		// Bus sync happens in studio-store on state changes; the overlay
		// just decides whether to render. Subscribe once for the lifetime
		// of the overlay so reconfigures don't churn listeners.
		if (!this.unsubscribe) {
			this.unsubscribe = chatBus.subscribe((msg) => this.ingest(msg));
		}
		if (!config.enabled) {
			this.messages = [];
			return;
		}
		// Seed with whatever the bus already has so a late `enable` shows
		// recent backlog instead of an empty panel.
		this.messages = chatBus.getHistory(config.maxMessages);
	}

	stop(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
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

	/** True when at least one platform connector reports connected state. */
	isConnected(): boolean {
		return chatBus.isConnected();
	}

	getConfig(): ChatOverlayConfig | null {
		return this.config;
	}

	/** Push a synthetic message into the overlay. Goes through the bus so
	 * every subscriber sees it. */
	inject(msg: ChatMessage): void {
		chatBus.inject(msg);
	}

	private ingest(msg: ChatMessage): void {
		this.messages.push(msg);
		const cap = this.config?.maxMessages ?? 6;
		if (this.messages.length > cap) this.messages = this.messages.slice(-cap);
	}

	/** Called by StreamEngine each composite frame. Bail fast when off so
	 * we don't pay for measureText on idle frames. */
	draw(ctx: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number): void {
		const config = this.config;
		if (!config?.enabled) return;
		// Render only when at least one connector is configured. The
		// legacy `channel` field counts; new code also populates
		// `channels.<platform>` entries.
		const hasAny = !!config.channel || hasAnyChannel(config);
		if (!hasAny) return;
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
		ctx.fillText(headerLabel(config), x + PANEL_PADDING, y + PANEL_PADDING);

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

function hasAnyChannel(config: ChatOverlayConfig): boolean {
	const map = config.channels;
	if (!map) return false;
	return Object.values(map).some((v) => !!v && v.length > 0);
}

function headerLabel(config: ChatOverlayConfig): string {
	const map = config.channels ?? {};
	const labels: string[] = [];
	if (map.twitch || config.channel) labels.push(`#${map.twitch || config.channel}`);
	if (map.kick) labels.push(`kick/${map.kick}`);
	if (map.youtube) labels.push("YouTube");
	const prefix = labels.length > 0 ? `${labels.join(" · ")} · ` : "";
	return `${prefix}LIVE CHAT`;
}

export const chatOverlay = new ChatOverlay();
