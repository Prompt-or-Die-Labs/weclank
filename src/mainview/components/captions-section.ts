// Captions section — left-rail accordion that toggles the live captions
// overlay. The overlay reads from the mic transcriber, so the toggle is
// only useful when there's an audio source available. If there isn't, the
// switch still works but we surface a hint so the streamer knows why
// captions won't appear yet.

import { Component } from "../core/component";
import { Icons } from "../core/icons";
import { studio } from "../state/studio-store";
import type { Participant } from "../core/types";
import { isCaptionsEnabled, setCaptionsEnabled, subscribeCaptionsEnabled } from "../streaming/captions-overlay";

const COLLAPSED_KEY = "studio.captionsSection.collapsed";

interface State {
	enabled: boolean;
	hasMicSource: boolean;
	collapsed: boolean;
}

function readCollapsed(): boolean {
	try { return localStorage.getItem(COLLAPSED_KEY) === "1"; } catch { return false; }
}
function writeCollapsed(value: boolean): void {
	try { localStorage.setItem(COLLAPSED_KEY, value ? "1" : "0"); } catch { /* unavailable */ }
}

function hasMicCapableSource(participants: Record<string, Participant>): boolean {
	for (const p of Object.values(participants)) {
		if (p.isAgent) continue;
		if (p.kind === "mic" || p.kind === "camera") return true;
	}
	return false;
}

export class CaptionsSection extends Component<State> {
	private captionsUnsub: (() => void) | null = null;

	constructor() {
		super({
			enabled: isCaptionsEnabled(),
			hasMicSource: hasMicCapableSource(studio.state.participants),
			collapsed: readCollapsed(),
		});
		studio.select((s) => s.participants, (participants) => {
			this.setState({ hasMicSource: hasMicCapableSource(participants) });
		});
		// Hold the subscription outside the disposers array so it survives
		// re-renders; cleared explicitly in beforeDestroy.
		this.captionsUnsub = subscribeCaptionsEnabled((enabled) => this.setState({ enabled }));
	}

	protected rootClass(): string {
		return "scene-panel__section scene-panel__section--compact captions-section";
	}

	protected update(): void {
		this.el.classList.toggle("is-collapsed", this.state.collapsed);
		super.update();
	}

	protected afterMount(): void {
		this.el.classList.toggle("is-collapsed", this.state.collapsed);
	}

	protected beforeDestroy(): void {
		this.captionsUnsub?.();
		this.captionsUnsub = null;
	}

	protected template(): string {
		const { enabled, hasMicSource, collapsed } = this.state;
		return `
			<div class="scene-panel__head">
				<button class="scene-panel__head-toggle" data-captions-toggle type="button" aria-expanded="${collapsed ? "false" : "true"}" aria-controls="captions-body">
					<span class="scene-panel__chevron" aria-hidden="true">${Icons.chevronDown(12)}</span>
					<span class="section-header">Captions</span>
				</button>
			</div>
			<div class="captions-section__body" id="captions-body"${collapsed ? ' hidden=""' : ""}>
				<label class="captions-section__switch">
					<input type="checkbox" data-captions-switch ${enabled ? "checked" : ""} />
					<span class="captions-section__switch-track" aria-hidden="true"></span>
					<span class="captions-section__switch-label">${enabled ? "On" : "Off"}</span>
				</label>
				${!hasMicSource ? '<p class="captions-section__hint">Add a microphone or camera-with-audio source to capture captions.</p>' : ""}
			</div>
		`;
	}

	protected bind(): void {
		this.on(this.$("[data-captions-toggle]"), "click", () => {
			const next = !this.state.collapsed;
			writeCollapsed(next);
			this.setState({ collapsed: next });
		});
		this.on(this.$<HTMLInputElement>("[data-captions-switch]"), "change", (e) => {
			const input = e.currentTarget as HTMLInputElement;
			setCaptionsEnabled(input.checked);
		});
	}
}
