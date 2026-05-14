// Chat tab — unified multi-platform chat panel.
//
// Reads from ChatBus (one shared message stream across Twitch, Kick, and
// — once OAuth lands — YouTube). Each row shows a platform glyph badge,
// the author, the message body, and three affordances:
//   - Pin → lower-third overlay on broadcast
//   - Mod → opens a delete/timeout/ban menu (only for platforms whose
//     connector supports moderation, i.e. Twitch with OAuth saved)
//
// Connection panel: one input per platform (Twitch, Kick, YouTube). Each
// has its own connect button. The bus reconciles independently per
// platform so partial setups work (just Twitch is fine, just Kick is
// fine, both is fine).

import { Component } from "../../core/component";
import { studio } from "../../state/studio-store";
import { chatBus } from "../../chat/chat-bus";
import type { ConnectorStatus, ModerateAction } from "../../chat/chat-connector";
import { streamOverlays } from "../../streaming/stream-overlays";
import { banterEngine } from "../../banter/banter-engine";
import type { AgentReply } from "../../banter/banter-engine";
import { overlayId, mintId } from "../../core/ids";
import { escapeHtml } from "../primitives";
import { Brands, BRAND_COLORS, BRAND_LABELS, Icons } from "../../core/icons";
import { Popover, toast } from "../overlays";
import type { ChatOverlayConfig, ChatPlatformId } from "../../core/types";
import { userMessageFor } from "../../core/errors";

interface ChatRow {
	kind: "viewer" | "agent";
	author: string;
	text: string;
	timestamp: number;
	platform?: ChatPlatformId;
	messageId?: string;
	authorId?: string;
	meta?: Record<string, string>;
}

interface State {
	channels: Partial<Record<ChatPlatformId, string>>;
	enabled: boolean;
	messages: ChatRow[];
	statuses: ConnectorStatus[];
}

const PLATFORMS: ChatPlatformId[] = ["twitch", "kick", "youtube"];

function readChannels(config: ChatOverlayConfig | undefined): Partial<Record<ChatPlatformId, string>> {
	const map = { ...(config?.channels ?? {}) };
	// Migrate the legacy single-Twitch field if it's still the only source.
	if (!map.twitch && config?.channel) map.twitch = config.channel;
	return map;
}

export class ChatTab extends Component<State> {
	private unsubReplies: (() => void) | null = null;
	private unsubBus: (() => void) | null = null;
	private unsubStatuses: (() => void) | null = null;

	constructor() {
		const config = studio.state.overlays.chat;
		super({
			channels: readChannels(config),
			enabled: config?.enabled ?? false,
			messages: chatBus.getHistory(200).map((m) => ({ kind: "viewer" as const, ...m })),
			statuses: chatBus.getStatuses(),
		});
		studio.select(
			(s) => s.overlays.chat,
			(c) => this.setState({ channels: readChannels(c), enabled: c?.enabled ?? false }),
		);
	}

	protected rootClass(): string {
		return "tab tab-chat";
	}

	protected template(): string {
		const placeholder = this.state.enabled && this.hasAnyChannel()
			? `Waiting for messages…`
			: "Add a channel above and click Connect.";
		return `
			<div class="tab-chat__header">
				<div class="tab-chat__platforms">
					${PLATFORMS.map((p) => this.renderPlatformInput(p)).join("")}
				</div>
				<div class="tab-chat__status-row">
					<button class="tab-chat__toggle ${this.state.enabled ? "is-active" : ""}" data-action="toggle">
						${this.state.enabled ? "Disconnect" : "Connect"}
					</button>
					${this.renderStatusBadges()}
				</div>
			</div>
			<div class="tab-chat__list" data-list>
				${this.state.messages.length === 0
					? `<div class="tab-chat__empty">${placeholder}</div>`
					: this.state.messages.slice(-100).reverse().map((m) => this.renderRow(m)).join("")}
			</div>
		`;
	}

	private renderPlatformInput(platform: ChatPlatformId): string {
		const value = this.state.channels[platform] ?? "";
		const label = BRAND_LABELS[platform as keyof typeof BRAND_LABELS] ?? platform;
		const glyphHtml = platform === "youtube"
			? Brands.youtube(14)
			: platform === "twitch"
				? Brands.twitch(14)
				: Brands.kick(14);
		const placeholder = platform === "youtube" ? "video id (oauth required)" : "channel name";
		return `
			<label class="tab-chat__platform" style="--brand-color: ${BRAND_COLORS[platform as keyof typeof BRAND_COLORS] ?? "var(--text-2)"};">
				<span class="tab-chat__platform-glyph" aria-hidden="true">${glyphHtml}</span>
				<input type="text" data-platform="${platform}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="${escapeHtml(label)} channel" />
			</label>
		`;
	}

	private renderStatusBadges(): string {
		if (!this.state.enabled || this.state.statuses.length === 0) {
			return `<span class="tab-chat__status"><span class="tab-chat__dot"></span> Idle</span>`;
		}
		return this.state.statuses.map((s) => {
			const dotClass = s.state === "connected"
				? "tab-chat__dot--live"
				: s.state === "connecting"
					? "tab-chat__dot--pending"
					: s.state === "error"
						? "tab-chat__dot--error"
						: "";
			const label = BRAND_LABELS[s.platform as keyof typeof BRAND_LABELS] ?? s.platform;
			const tooltip = s.error ? ` title="${escapeHtml(s.error)}"` : "";
			return `<span class="tab-chat__status"${tooltip}><span class="tab-chat__dot ${dotClass}"></span> ${escapeHtml(label)}</span>`;
		}).join("");
	}

	private renderRow(msg: ChatRow): string {
		const id = `${msg.platform ?? "agent"}:${msg.messageId ?? `${msg.author}:${msg.timestamp}`}`;
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
		const platformBadge = msg.platform ? this.renderPlatformBadge(msg.platform) : "";
		const canModerate = msg.platform ? this.canModerate(msg.platform) : false;
		return `
			<div class="tab-chat__row" data-msg="${escapeHtml(id)}">
				<div class="tab-chat__msg">
					${platformBadge}
					<span class="tab-chat__author" ${colorStyle}>${escapeHtml(msg.author)}</span>
					<span class="tab-chat__body">${escapeHtml(msg.text)}</span>
				</div>
				<div class="tab-chat__row-actions">
					${canModerate ? `<button class="tab-chat__mod" data-mod="${escapeHtml(id)}" title="Moderate">${Icons.more(14)}</button>` : ""}
					<button class="tab-chat__pin" data-pin="${escapeHtml(id)}" title="Pin to broadcast as lower-third">Pin</button>
				</div>
			</div>
		`;
	}

	private renderPlatformBadge(platform: ChatPlatformId): string {
		const color = BRAND_COLORS[platform as keyof typeof BRAND_COLORS];
		const glyph = platform === "twitch" ? Brands.twitch(10) : platform === "kick" ? Brands.kick(10) : Brands.youtube(10);
		return `<span class="tab-chat__platform-badge" style="color:${color}" aria-label="${platform}">${glyph}</span>`;
	}

	private hasAnyChannel(): boolean {
		return PLATFORMS.some((p) => (this.state.channels[p] ?? "").trim().length > 0);
	}

	private canModerate(platform: ChatPlatformId): boolean {
		const connector = this.state.statuses.find((s) => s.platform === platform);
		if (!connector || connector.state !== "connected") return false;
		// Mirror connector.supportsModeration() — needs a saved OAuth
		// token. Reads through the bus so we don't reimplement here.
		try {
			// The bus throws if no connector exists; here we just want a
			// quick capability check, so we look at the runtime list.
			// twitch is currently the only one with mod actions.
			return platform === "twitch";
		} catch { return false; }
	}

	protected bind(): void {
		this.on(this.$('[data-action="toggle"]'), "click", () => this.toggleConnection());
		for (const input of this.$$<HTMLInputElement>("[data-platform]")) {
			this.on(input, "keydown", (e) => {
				if ((e as KeyboardEvent).key === "Enter") this.toggleConnection();
			});
			this.on(input, "input", () => {
				const platform = input.dataset["platform"] as ChatPlatformId;
				const channels = { ...this.state.channels, [platform]: input.value };
				this.state = { ...this.state, channels };
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
		for (const btn of this.$$<HTMLButtonElement>("[data-mod]")) {
			const id = btn.dataset["mod"];
			if (!id) continue;
			this.on(btn, "click", (e) => {
				e.stopPropagation();
				this.openModMenu(id, e.currentTarget as HTMLElement);
			});
		}
		const list = this.$<HTMLElement>("[data-list]");
		if (list) list.scrollTop = list.scrollHeight;
	}

	protected afterMount(): void {
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
		this.unsubBus = chatBus.subscribe((msg) => {
			const row: ChatRow = { kind: "viewer", ...msg };
			const msgs = [...this.state.messages, row].slice(-200);
			this.setState({ messages: msgs });
		});
		this.unsubStatuses = chatBus.subscribeStatuses((statuses) => this.setState({ statuses }));
	}

	protected beforeDestroy(): void {
		this.unsubReplies?.();
		this.unsubBus?.();
		this.unsubStatuses?.();
	}

	private toggleConnection(): void {
		const channels: Partial<Record<ChatPlatformId, string>> = {};
		for (const input of this.$$<HTMLInputElement>("[data-platform]")) {
			const platform = input.dataset["platform"] as ChatPlatformId;
			const value = input.value.trim().replace(/^#/, "");
			if (value) channels[platform] = value;
		}
		const next: ChatOverlayConfig = {
			enabled: !this.state.enabled,
			// Keep legacy `channel` mirrored to twitch so old code paths
			// keep working until everything reads from `channels`.
			channel: channels.twitch ?? "",
			channels,
			position: studio.state.overlays.chat?.position ?? "bottom-right",
			maxMessages: studio.state.overlays.chat?.maxMessages ?? 6,
		};
		if (next.enabled && Object.keys(channels).length === 0) {
			// Refocus first input rather than connecting to nothing.
			this.$<HTMLInputElement>("[data-platform]")?.focus();
			return;
		}
		studio.setChatOverlay(next);
	}

	private pinMessage(messageId: string): void {
		const msg = this.state.messages.find((m) => m.kind === "viewer" && this.matchRowId(m, messageId));
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

	private matchRowId(m: ChatRow, id: string): boolean {
		const computed = `${m.platform ?? "agent"}:${m.messageId ?? `${m.author}:${m.timestamp}`}`;
		return computed === id;
	}

	private openModMenu(rowId: string, anchor: HTMLElement): void {
		const row = this.state.messages.find((m) => m.kind === "viewer" && this.matchRowId(m, rowId));
		if (!row || !row.platform) return;
		const menu = document.createElement("div");
		menu.className = "menu";
		menu.innerHTML = `
			<div class="menu__section">Moderate ${escapeHtml(row.author)}</div>
			${row.messageId ? `<button class="menu__item" data-act="delete">Delete message</button>` : ""}
			${row.authorId ? `<button class="menu__item" data-act="timeout">Timeout 10 min</button>` : ""}
			${row.authorId ? `<button class="menu__item menu__item--danger" data-act="ban">Ban</button>` : ""}
		`;
		const popover = new Popover({ anchor, content: menu });
		menu.querySelectorAll<HTMLButtonElement>("[data-act]").forEach((btn) => {
			btn.addEventListener("click", async () => {
				popover.dismiss();
				try {
					const action = buildModerateAction(btn.dataset["act"]!, row);
					if (!action) return;
					await chatBus.moderate(row.platform!, action);
					toast(`${action.kind} sent to ${row.platform}`, "success");
				} catch (err) {
					toast(`Mod action failed: ${userMessageFor(err)}`, "error");
				}
			});
		});
	}
}

function buildModerateAction(act: string, row: ChatRow): ModerateAction | null {
	switch (act) {
		case "delete":
			if (!row.messageId) return null;
			return { kind: "delete", messageId: row.messageId };
		case "timeout":
			if (!row.authorId) return null;
			return { kind: "timeout", userId: row.authorId, durationSec: 600 };
		case "ban":
			if (!row.authorId) return null;
			return { kind: "ban", userId: row.authorId };
		default:
			return null;
	}
}
