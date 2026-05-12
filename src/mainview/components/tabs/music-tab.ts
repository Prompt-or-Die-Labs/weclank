// Music tab — current track + volume + button to open the full music
// generator dialog (Suno).

import { Component } from "../../core/component";
import { studio } from "../../state/studio-store";
import { openMusicPanel } from "../../streaming/music-dialog";
import { escapeHtml } from "../primitives";
import type { MusicTrack } from "../../core/types";

interface State {
	current: MusicTrack | null;
	volume: number;
}

export class MusicTab extends Component<State> {
	constructor() {
		super({
			current: studio.state.music.current,
			volume: studio.state.music.volume,
		});
		studio.select(
			(s) => s.music.current,
			(current) => this.setState({ current }),
		);
		studio.select(
			(s) => s.music.volume,
			(volume) => this.setState({ volume }),
		);
	}

	protected rootClass(): string {
		return "tab tab-music";
	}

	protected template(): string {
		const v = Math.round(this.state.volume * 100);
		return `
			<div class="tab-music__current">
				<div class="tab-music__label">NOW PLAYING</div>
				<div class="tab-music__title">${this.state.current ? escapeHtml(this.state.current.title) : "Nothing playing"}</div>
				${this.state.current?.prompt ? `<div class="tab-music__prompt">${escapeHtml(this.state.current.prompt)}</div>` : ""}
			</div>
			<div class="tab-music__volume">
				<label>Volume <span data-volume-num>${v}%</span></label>
				<input type="range" min="0" max="100" value="${v}" data-volume />
			</div>
			<div class="tab-music__actions">
				<button data-action="open">Generate / queue music…</button>
			</div>
		`;
	}

	protected bind(): void {
		const slider = this.$<HTMLInputElement>("[data-volume]");
		const num = this.$<HTMLElement>("[data-volume-num]");
		if (slider && num) {
			this.on(slider, "input", () => {
				const v = Number(slider.value);
				num.textContent = `${v}%`;
				studio.setMusicVolume(v / 100);
			});
		}
		this.on(this.$('[data-action="open"]'), "click", () => openMusicPanel());
	}
}
