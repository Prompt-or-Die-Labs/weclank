// Broadcast section — left-rail accordion that surfaces the quality picker
// and the local-recording toggle. Mirrors the controls in the header's
// stream-status dropdown so the streamer doesn't need to chase a dropdown
// mid-show. Same toggle still works from the header.

import { Component } from "../core/component";
import { Icons } from "../core/icons";
import { studio } from "../state/studio-store";
import type { StreamConfig, StreamQuality } from "../core/types";
import { localRecorder } from "../streaming/recorder";
import { toast } from "./overlays";
import { userMessageFor } from "../core/errors";

const COLLAPSED_KEY = "studio.broadcastSection.collapsed";
const QUALITIES: StreamQuality[] = ["480p", "720p", "1080p"];

interface State {
	stream: StreamConfig;
	collapsed: boolean;
}

function readCollapsed(): boolean {
	try { return localStorage.getItem(COLLAPSED_KEY) === "1"; } catch { return false; }
}
function writeCollapsed(value: boolean): void {
	try { localStorage.setItem(COLLAPSED_KEY, value ? "1" : "0"); } catch { /* unavailable */ }
}

export class BroadcastSection extends Component<State> {
	constructor() {
		super({ stream: studio.state.stream, collapsed: readCollapsed() });
		studio.select((s) => s.stream, (stream) => this.setState({ stream }));
	}

	protected rootClass(): string {
		return "scene-panel__section scene-panel__section--compact broadcast-section";
	}

	protected update(): void {
		this.el.className = `${this.rootClass()}${this.state.collapsed ? " is-collapsed" : ""}`;
		super.update();
	}

	protected afterMount(): void {
		this.el.className = `${this.rootClass()}${this.state.collapsed ? " is-collapsed" : ""}`;
	}

	protected template(): string {
		const { stream, collapsed } = this.state;
		const recording = stream.recording || localRecorder.isRecording;
		return `
			<div class="scene-panel__head">
				<button class="scene-panel__head-toggle" data-broadcast-toggle type="button" aria-expanded="${collapsed ? "false" : "true"}" aria-controls="broadcast-body">
					<span class="scene-panel__chevron" aria-hidden="true">${Icons.chevronDown(12)}</span>
					<span class="section-header">Broadcast</span>
				</button>
			</div>
			<div class="broadcast-section__body" id="broadcast-body"${collapsed ? ' hidden=""' : ""}>
				<div class="broadcast-section__quality" role="radiogroup" aria-label="Stream quality">
					${QUALITIES.map((q) => `
						<button
							class="broadcast-section__quality-btn${q === stream.quality ? " is-active" : ""}"
							role="radio"
							aria-checked="${q === stream.quality ? "true" : "false"}"
							data-quality="${q}"
							type="button"
						>${q}</button>
					`).join("")}
				</div>
				<button class="broadcast-section__rec${recording ? " is-on" : ""}" type="button" data-broadcast-rec aria-pressed="${recording ? "true" : "false"}">
					<span class="broadcast-section__rec-dot" aria-hidden="true"></span>
					${recording ? "Stop local recording" : "Start local recording"}
				</button>
			</div>
		`;
	}

	protected bind(): void {
		this.on(this.$("[data-broadcast-toggle]"), "click", () => {
			const next = !this.state.collapsed;
			writeCollapsed(next);
			this.setState({ collapsed: next });
		});
		for (const btn of this.$$<HTMLButtonElement>("[data-quality]")) {
			this.on(btn, "click", () => {
				const next = btn.dataset["quality"] as StreamQuality;
				if (next === this.state.stream.quality) return;
				studio.setStream({ quality: next });
				toast(`Quality set to ${next}`, "success");
			});
		}
		this.on(this.$("[data-broadcast-rec]"), "click", () => void this.toggleRecording());
	}

	private async toggleRecording(): Promise<void> {
		const recording = this.state.stream.recording || localRecorder.isRecording;
		if (recording) { localRecorder.stop(); return; }
		try {
			const started = await localRecorder.start();
			if (!started) return;
			toast("Recording to disk", "success");
		} catch (err) {
			toast(`Recording failed: ${userMessageFor(err)}`, "error");
		}
	}
}
