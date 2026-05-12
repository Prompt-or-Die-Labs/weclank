// Notes tab — Claude Code / Codex transcript watcher status. Click
// "Configure…" to open the existing transcript-watcher dialog.

import { Component } from "../../core/component";
import { studio } from "../../state/studio-store";
import { pickTranscriptConfig } from "../../transcript/config-dialog";
import { syncTranscriptFeed, transcriptFeed } from "../../transcript/feed";
import { escapeHtml } from "../primitives";

interface State {
	path: string;
	enabled: boolean;
	recent: string[];
}

export class NotesTab extends Component<State> {
	private poll = 0;

	constructor() {
		const t = studio.state.transcript;
		super({
			path: t?.path ?? "",
			enabled: !!t?.enabled,
			recent: transcriptFeed.recentSummaries(6),
		});
		studio.select(
			(s) => s.transcript,
			(t) => this.setState({ path: t?.path ?? "", enabled: !!t?.enabled }),
		);
	}

	protected rootClass(): string {
		return "tab tab-notes";
	}

	protected template(): string {
		const status = this.state.enabled
			? this.state.path
				? `<span class="tab-notes__dot tab-notes__dot--live"></span> Watching <code>${escapeHtml(this.state.path)}</code>`
				: '<span class="tab-notes__dot tab-notes__dot--pending"></span> Enabled but no path'
			: '<span class="tab-notes__dot"></span> Off';
		return `
			<div class="tab-notes__head">
				<h3>Coding transcript</h3>
				<p>Tail a Claude Code or Codex JSONL session so AI co-hosts can comment on your work in real time.</p>
				<div class="tab-notes__status">${status}</div>
				<button data-action="configure">${this.state.enabled ? "Reconfigure…" : "Set path…"}</button>
			</div>
			<div class="tab-notes__recent">
				<div class="section-header">Recent events</div>
				${this.state.recent.length === 0
					? '<div class="tab-notes__empty">No events yet.</div>'
					: `<ul>${this.state.recent.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul>`}
			</div>
		`;
	}

	protected bind(): void {
		this.on(this.$('[data-action="configure"]'), "click", async () => {
			const next = await pickTranscriptConfig(studio.state.transcript);
			if (!next) return;
			studio.setTranscript(next);
			await syncTranscriptFeed();
		});
	}

	protected afterMount(): void {
		this.poll = window.setInterval(() => {
			this.setState({ recent: transcriptFeed.recentSummaries(6) });
		}, 3000);
	}

	protected beforeDestroy(): void {
		clearInterval(this.poll);
	}
}
