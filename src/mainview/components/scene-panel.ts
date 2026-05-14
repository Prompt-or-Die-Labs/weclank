// Left rail container. Mounts four self-managing accordion sections — each
// owns its own collapse state, its own DOM, and its own event listeners.
//
// ScenePanel itself never re-renders, so the sections survive store-driven
// updates without the destroy/recreate churn that earlier versions hit.

import { Component } from "../core/component";
import { ScenesSection } from "./scenes-section";
import { SourcesList } from "./sources-list";
import { BroadcastSection } from "./broadcast-section";
import { CaptionsSection } from "./captions-section";

export class ScenePanel extends Component<Record<string, never>> {
	private scenesSection: ScenesSection | null = null;
	private sourcesList: SourcesList | null = null;
	private broadcastSection: BroadcastSection | null = null;
	private captionsSection: CaptionsSection | null = null;

	constructor() {
		super({});
	}

	protected rootClass(): string {
		return "scene-panel";
	}

	protected template(): string {
		// Stable mount points (display: contents in CSS) — each section's
		// own root div becomes a direct flex child of .scene-panel.
		return `
			<div data-mount="scenes"></div>
			<div data-mount="sources"></div>
			<div data-mount="broadcast"></div>
			<div data-mount="captions"></div>
		`;
	}

	protected afterMount(): void {
		this.scenesSection = new ScenesSection();
		this.scenesSection.mount(this.$<HTMLElement>('[data-mount="scenes"]'));
		this.sourcesList = new SourcesList();
		this.sourcesList.mount(this.$<HTMLElement>('[data-mount="sources"]'));
		this.broadcastSection = new BroadcastSection();
		this.broadcastSection.mount(this.$<HTMLElement>('[data-mount="broadcast"]'));
		this.captionsSection = new CaptionsSection();
		this.captionsSection.mount(this.$<HTMLElement>('[data-mount="captions"]'));
	}

	protected beforeDestroy(): void {
		this.scenesSection?.destroy();
		this.sourcesList?.destroy();
		this.broadcastSection?.destroy();
		this.captionsSection?.destroy();
	}
}
