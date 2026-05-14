// Channel strip — small circular icons in the header that show every
// saved streaming destination. Active channels are filled with their brand
// color; inactive channels are outlined and muted. Click toggles whether
// the channel is part of the next/current broadcast. The trailing "+"
// circle opens the link-channel dialog.
//
// State sources:
//   loadChannels() / subscribeChannels  → list of saved channels
//   studio.state.stream.activeChannelIds → per-stream selection
//
// "Empty" activeChannelIds means "broadcast to all" (back-compat with
// pre-channels behaviour). Once the user toggles any chip, the array
// becomes explicit and persists.

import { Component } from "../core/component";
import { Brands, BRAND_COLORS, BRAND_LABELS, Icons } from "../core/icons";
import type { BrandId } from "../core/icons";
import { studio } from "../state/studio-store";
import type { RtmpChannel } from "../core/types";
import { loadChannels, subscribeChannels } from "../streaming/channels";
import { openChannelLinkDialog } from "../streaming/channel-link-dialog";
import { Popover, toast } from "./overlays";
import { escapeHtml } from "./primitives";

interface State {
	channels: RtmpChannel[];
	activeIds: string[];
}

export class ChannelStrip extends Component<State> {
	constructor() {
		super({
			channels: loadChannels(),
			activeIds: studio.state.stream.activeChannelIds ?? [],
		});
		studio.select((s) => s.stream.activeChannelIds ?? [], (activeIds) => this.setState({ activeIds }));
	}

	protected rootClass(): string {
		return "channel-strip";
	}

	protected afterMount(): void {
		const unsub = subscribeChannels(() => this.setState({ channels: loadChannels() }));
		this.track(unsub);
	}

	private isActive(channelId: string): boolean {
		const { activeIds, channels } = this.state;
		// Empty selection means "broadcast to every saved channel" — every
		// chip appears active.
		if (activeIds.length === 0) return channels.length > 0;
		return activeIds.includes(channelId);
	}

	protected template(): string {
		const { channels } = this.state;
		const tip = channels.length === 0 ? "Link a channel" : "Add channel";
		return `
			<div class="channel-strip__list" role="group" aria-label="Stream channels">
				${channels.map((c) => this.renderChip(c)).join("")}
			</div>
			<button class="channel-strip__add" id="add-channel" type="button" title="${tip}" aria-label="${tip}">${Icons.plus(14)}</button>
		`;
	}

	private renderChip(channel: RtmpChannel): string {
		const active = this.isActive(channel.id);
		const brand = channel.platform !== "custom" ? channel.platform as BrandId : null;
		const color = brand ? BRAND_COLORS[brand] : "var(--text-2)";
		const label = brand ? BRAND_LABELS[brand] : "Custom";
		const glyph = brand ? Brands[brand](14) : Icons.layoutSwap(14);
		const title = `${label}${channel.label && channel.label !== label ? ` — ${channel.label}` : ""}${active ? " · active" : ""}`;
		return `
			<button
				class="channel-strip__chip${active ? " is-active" : ""}"
				data-channel-id="${escapeHtml(channel.id)}"
				type="button"
				title="${escapeHtml(title)}"
				aria-label="${escapeHtml(title)}"
				aria-pressed="${active ? "true" : "false"}"
				style="--chip-color: ${color};"
			>${glyph}</button>
		`;
	}

	protected bind(): void {
		for (const chip of this.$$<HTMLButtonElement>("[data-channel-id]")) {
			const id = chip.dataset["channelId"] ?? "";
			this.on(chip, "click", () => this.toggle(id));
			this.on(chip, "contextmenu", (e) => {
				e.preventDefault();
				this.openChannelMenu(id, chip);
			});
		}
		this.on(this.$("#add-channel"), "click", () => void this.onAdd());
	}

	private toggle(channelId: string): void {
		const { activeIds, channels } = this.state;
		// Materialize the implicit "all" selection before toggling so the
		// click feels predictable — clicking an active chip removes it
		// rather than toggling every other chip on instead.
		const materialized = activeIds.length === 0 ? channels.map((c) => c.id) : activeIds;
		const next = materialized.includes(channelId)
			? materialized.filter((id) => id !== channelId)
			: [...materialized, channelId];
		studio.setStream({ activeChannelIds: next });
	}

	private openChannelMenu(channelId: string, anchor: HTMLElement): void {
		const channel = this.state.channels.find((c) => c.id === channelId);
		if (!channel) return;
		const menu = document.createElement("div");
		menu.className = "menu";
		menu.innerHTML = `
			<button class="menu__item" data-act="edit">Edit channel…</button>
			<button class="menu__item menu__item--danger" data-act="remove">Remove channel</button>
		`;
		const popover = new Popover({ anchor, content: menu });
		menu.querySelectorAll<HTMLButtonElement>("[data-act]").forEach((btn) => {
			btn.addEventListener("click", async () => {
				popover.dismiss();
				if (btn.dataset["act"] === "edit") {
					await openChannelLinkDialog({ edit: channel });
				} else {
					if (!window.confirm(`Remove ${channel.label || "this channel"}?`)) return;
					const { removeChannel } = await import("../streaming/channels");
					await removeChannel(channelId);
					// Drop the id from active selection too.
					const next = (this.state.activeIds ?? []).filter((id) => id !== channelId);
					studio.setStream({ activeChannelIds: next });
					toast("Channel removed");
				}
			});
		});
	}

	private async onAdd(): Promise<void> {
		const created = await openChannelLinkDialog();
		if (!created) return;
		// Auto-activate freshly-linked channels — most users link to use.
		const { activeIds, channels } = this.state;
		const materialized = activeIds.length === 0 ? channels.map((c) => c.id) : activeIds;
		studio.setStream({ activeChannelIds: [...materialized, created.id] });
		toast(`${BRAND_LABELS[created.platform as BrandId] ?? "Custom"} channel linked`, "success");
	}
}
