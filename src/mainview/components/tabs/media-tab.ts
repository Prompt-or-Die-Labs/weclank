// Media tab — placeholder until image/browser-source library lands.

import { Component } from "../../core/component";
import { openQrDialog } from "../qr-dialog";

export class MediaTab extends Component<Record<string, never>> {
	constructor() {
		super({});
	}

	protected rootClass(): string {
		return "tab tab-media";
	}

	protected template(): string {
		return `
			<div class="tab-media__intro">
				<h3>Media library</h3>
				<p>Images, QR codes, and browser sources. More controls land in a follow-up.</p>
			</div>
			<div class="tab-media__actions">
				<button data-action="qr">QR Code…</button>
			</div>
		`;
	}

	protected bind(): void {
		this.on(this.$('[data-action="qr"]'), "click", () => openQrDialog());
	}
}
