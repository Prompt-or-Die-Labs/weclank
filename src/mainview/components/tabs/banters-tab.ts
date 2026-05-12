// Banters tab — broadcast graphics (title cards, lower-thirds, notices,
// code snippets) currently on the canvas. Click an overlay to remove it.
// "Add overlay…" opens the existing overlay manager dialog.

import { Component } from "../../core/component";
import { studio } from "../../state/studio-store";
import type { StreamOverlay } from "../../core/types";
import { streamOverlays } from "../../streaming/stream-overlays";
import { openOverlayManager } from "../../streaming/overlay-dialog";
import { escapeHtml } from "../primitives";

interface State {
	overlays: StreamOverlay[];
}

export class BantersTab extends Component<State> {
	private poll = 0;

	constructor() {
		super({ overlays: studio.state.streamOverlays });
		studio.select(
			(s) => s.streamOverlays,
			(overlays) => this.setState({ overlays }),
		);
	}

	protected rootClass(): string {
		return "tab tab-banters";
	}

	protected template(): string {
		return `
			<div class="tab-banters__head">
				<div class="tab-banters__title">Live on broadcast · ${this.state.overlays.length}</div>
				<button class="tab-banters__add" data-action="add">Add overlay…</button>
			</div>
			<div class="tab-banters__list">
				${this.state.overlays.length === 0
					? '<div class="tab-banters__empty">No overlays on the broadcast. Click <strong>Add overlay…</strong>.</div>'
					: this.state.overlays.map((o) => this.renderRow(o)).join("")}
			</div>
		`;
	}

	private renderRow(o: StreamOverlay): string {
		const title = o.props.title || o.props.body || "(untitled)";
		const sub = o.props.subtitle ?? "";
		const remaining = o.expiresAt ? Math.max(0, Math.round((o.expiresAt - Date.now()) / 1000)) : null;
		return `
			<div class="tab-banters__row">
				<div class="tab-banters__row-main">
					<div class="tab-banters__kind">${escapeHtml(o.kind)}</div>
					<div class="tab-banters__row-title">${escapeHtml(title)}</div>
					${sub ? `<div class="tab-banters__row-sub">${escapeHtml(sub)}</div>` : ""}
				</div>
				<div class="tab-banters__row-meta">
					${remaining !== null ? `<span>${remaining}s</span>` : "<span>sticky</span>"}
					<button class="tab-banters__remove" data-remove="${escapeHtml(o.id)}">Remove</button>
				</div>
			</div>
		`;
	}

	protected bind(): void {
		this.on(this.$('[data-action="add"]'), "click", () => openOverlayManager());
		for (const btn of this.$$<HTMLButtonElement>("[data-remove]")) {
			const id = btn.dataset["remove"];
			if (!id) continue;
			this.on(btn, "click", () => streamOverlays.remove(id as Parameters<typeof streamOverlays.remove>[0]));
		}
	}

	protected afterMount(): void {
		// Re-render every second so the auto-dismiss countdowns tick visibly.
		this.poll = window.setInterval(() => this.update(), 1000);
	}

	protected beforeDestroy(): void {
		clearInterval(this.poll);
	}
}
