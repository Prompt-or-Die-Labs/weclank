// Chat tab — live Twitch chat panel with click-to-broadcast.
//
// Each message has a hover "pin" affordance that turns the message into
// a lower-third overlay on the broadcast canvas. This is the click-chat-
// to-overlay differentiator (Restream's signature feature) — implemented
// here against `streamOverlays.add()` which already drives the canvas.
//
// Channel config is inline (no dialog). Polling at 1Hz is plenty for
// Twitch chat traffic levels.

import { Component } from "../../core/component";
import { studio } from "../../state/studio-store";
import { chatOverlay } from "../../streaming/chat-overlay";
import { streamOverlays } from "../../streaming/stream-overlays";
import { banterEngine } from "../../banter/banter-engine";
import type { AgentReply } from "../../banter/banter-engine";
import { overlayId, mintId } from "../../core/ids";
import { escapeHtml } from "../primitives";
import type { ChatOverlayConfig } from "../../core/types";

interface ChatRow {
	kind: "viewer" | "agent";
	author: string;
	text: string;
	timestamp: number;
	meta?: Record<string, string>;
}

interface State {
	channel: string;
	enabled: boolean;
	messages: ChatRow[];
	connected: boolean;
}

export class ChatTab extends Component<State> {
	private poll = 0;
	private channelInput: HTMLInputElement | null = null;
	private unsubReplies: (() => void) | null = null;

	constructor() {
		const config = studio.state.overlays.chat;
		super({
			channel: config?.channel ?? "",
			enabled: config?.enabled ?? false,
			messages: chatOverlay.getMessages().map((m) => ({ kind: "viewer" as const, ...m })),
			connected: chatOverlay.isConnected(),
		});
		studio.select(
			(s) => s.overlays.chat,
			(c) => this.setState({
				channel: c?.channel ?? "",
				enabled: c?.enabled ?? false,
			}),
		);
	}

	protected rootClass(): string {
		return "tab tab-chat";
	}

	protected template(): string {
		const placeholder = this.state.enabled && this.state.channel
			? `Waiting for messages from #${escapeHtml(this.state.channel)}…`
			: "Connect to a Twitch channel above.";
		return `
			<div class="tab-chat__header">
				<div class="tab-chat__form">
					<span class="tab-chat__hash">#</span>
					<input type="text" data-field="channel" value="${escapeHtml(this.state.channel)}" placeholder="twitch_channel" autocapitalize="off" autocorrect="off" spellcheck="false" />
					<button class="tab-chat__toggle ${this.state.enabled ? "is-active" : ""}" data-action="toggle">
						${this.state.enabled ? "Disconnect" : "Connect"}
					</button>
				</div>
				<div class="tab-chat__status">
					${this.state.enabled
						? this.state.connected
							? `<span class="tab-chat__dot tab-chat__dot--live"></span> Connected · ${this.state.messages.length} msg`
							: `<span class="tab-chat__dot tab-chat__dot--pending"></span> Connecting…`
						: `<span class="tab-chat__dot"></span> Idle`}
				</div>
			</div>
			<div class="tab-chat__list" data-list>
				${this.state.messages.length === 0
					? `<div class="tab-chat__empty">${placeholder}</div>`
					: this.state.messages.slice(-100).reverse().map((m) => this.renderRow(m)).join("")}
			</div>
		`;
	}

	private renderRow(msg: ChatRow): string {
		const id = `${msg.author}:${msg.timestamp}`;
		if (msg.kind === "agent") {
			return `
				<div class="tab-chat__row tab-chat__row--agent" data-msg="${escapeHtml(id)}">
					<div class="tab-chat__msg">
						<span class="tab-chat__author tab-chat__author--agent">${escapeHtml(msg.author)}</span>
						<span class="tab-chat__body">${escapeHtml(msg.text)}</span>
					</div>
				</div>
			`;
		}
		const color = msg.meta?.["color"] && msg.meta["color"].length === 7 ? msg.meta["color"] : null;
		const colorStyle = color ? `style="color:${color}"` : "";
		return `
			<div class="tab-chat__row" data-msg="${escapeHtml(id)}">
				<div class="tab-chat__msg">
					<span class="tab-chat__author" ${colorStyle}>${escapeHtml(msg.author)}</span>
					<span class="tab-chat__body">${escapeHtml(msg.text)}</span>
				</div>
				<button class="tab-chat__pin" data-pin="${escapeHtml(id)}" title="Pin to broadcast as lower-third">Pin</button>
			</div>
		`;
	}

	protected bind(): void {
		this.channelInput = this.$<HTMLInputElement>("[data-field=\"channel\"]");
		this.on(this.$('[data-action="toggle"]'), "click", () => this.toggleConnection());
		if (this.channelInput) {
			this.on(this.channelInput, "keydown", (e) => {
				if ((e as KeyboardEvent).key === "Enter") this.toggleConnection();
			});
		}
		for (const btn of this.$$<HTMLButtonElement>("[data-pin]")) {
			const id = btn.dataset["pin"];
			if (!id) continue;
			this.on(btn, "click", (e) => {
				e.stopPropagation();
				this.pinMessage(id);
			});
		}
		// Auto-scroll to bottom when new messages arrive.
		const list = this.$<HTMLElement>("[data-list]");
		if (list) list.scrollTop = list.scrollHeight;
	}

	protected afterMount(): void {
		this.poll = window.setInterval(() => this.tick(), 1000);
		this.unsubReplies = banterEngine.subscribeReplies((reply: AgentReply) => {
			const row: ChatRow = {
				kind: "agent",
				author: reply.agentName,
				text: reply.text,
				timestamp: reply.timestamp,
			};
			const msgs = [...this.state.messages, row].slice(-200);
			this.setState({ messages: msgs });
		});
	}

	protected beforeDestroy(): void {
		clearInterval(this.poll);
		this.unsubReplies?.();
	}

	private tick(): void {
		const connected = chatOverlay.isConnected();
		const incoming = chatOverlay.getMessages();
		// Merge new viewer messages (anything with a timestamp newer than
		// the last viewer row we have) preserving agent replies in order.
		const lastViewerTs = this.state.messages
			.filter((r) => r.kind === "viewer")
			.at(-1)?.timestamp ?? 0;
		const newViewer = incoming
			.filter((m) => m.timestamp > lastViewerTs)
			.map((m) => ({ kind: "viewer" as const, ...m }));
		if (newViewer.length > 0 || connected !== this.state.connected) {
			const merged = [...this.state.messages, ...newViewer].slice(-200);
			this.setState({ messages: merged, connected });
		} else if (connected !== this.state.connected) {
			this.setState({ connected });
		}
	}

	private toggleConnection(): void {
		const channel = this.channelInput?.value.trim().replace(/^#/, "") ?? "";
		const next: ChatOverlayConfig = {
			enabled: !this.state.enabled,
			channel,
			position: studio.state.overlays.chat?.position ?? "bottom-right",
			maxMessages: studio.state.overlays.chat?.maxMessages ?? 6,
		};
		if (next.enabled && !channel) {
			// Don't connect to an empty channel; refocus instead.
			this.channelInput?.focus();
			return;
		}
		studio.setChatOverlay(next);
	}

	private pinMessage(messageId: string): void {
		const msg = this.state.messages.find((m) => m.kind === "viewer" && `${m.author}:${m.timestamp}` === messageId);
		if (!msg) return;
		streamOverlays.add({
			id: mintId("ov", overlayId),
			kind: "lower-third",
			props: { title: msg.author, subtitle: msg.text },
			position: "lower-third",
			createdAt: Date.now(),
			expiresAt: Date.now() + 90_000,
		});
	}
}
