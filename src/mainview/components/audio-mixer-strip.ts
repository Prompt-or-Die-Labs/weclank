// Audio mixer strip — always-on horizontal row of channels. One channel
// per participant routed through the audio mixer. Each channel:
//   - vertical VU bars (canvas, rAF-driven from the participant's analyser)
//   - gain slider (0..1.5, vertical)
//   - M (mute) button
//   - name label (mono)
//
// One shared rAF loop iterates all channels, mirroring the SCRATCH-buffer
// pattern from the old tool-rail speaking-ring loop — keeps allocations
// to zero per frame.

import { Component } from "../core/component";
import { studio } from "../state/studio-store";
import { audioMixer } from "../streaming/audio-mixer";
import type { Participant } from "../core/types";
import { escapeHtml, escapeAttr } from "./primitives";

interface State {
	participants: Participant[];
}

const SCRATCH = new Uint8Array(new ArrayBuffer(1024));
const BAR_COUNT = 16;
const BAR_GAP = 1;

export class AudioMixerStrip extends Component<State> {
	private raf = 0;

	constructor() {
		super({ participants: collectAudioable(studio.state.participants) });
		studio.select(
			(s) => s.participants,
			(participants) => this.setState({ participants: collectAudioable(participants) }),
		);
	}

	protected rootClass(): string {
		return "audio-mixer-strip";
	}

	protected template(): string {
		if (this.state.participants.length === 0) {
			return '<div class="mixer__empty">No audio sources yet. Add a camera or AI co-host to populate the mixer.</div>';
		}
		return this.state.participants.map((p) => this.renderChannel(p)).join("");
	}

	private renderChannel(p: Participant): string {
		const gain = Math.round((audioMixer.getGain(p.id) || 1) * 100);
		return `
			<div class="mixer__channel" data-pid="${escapeHtml(p.id)}">
				<div class="mixer__fader">
					<canvas class="mixer__vu" width="14" height="64" data-vu></canvas>
					<input class="mixer__gain" type="range" min="0" max="150" value="${gain}" data-gain orient="vertical" aria-label="Gain for ${escapeHtml(p.displayName)}" />
				</div>
				<button class="mixer__mute ${p.muted ? "is-muted" : ""}" data-mute aria-pressed="${p.muted ? "true" : "false"}" title="Mute" aria-label="${escapeAttr(`Mute ${p.displayName}`)}">M</button>
				<div class="mixer__name" title="${escapeHtml(p.displayName)}">${escapeHtml(p.displayName)}</div>
			</div>
		`;
	}

	protected bind(): void {
		for (const ch of this.$$<HTMLElement>("[data-pid]")) {
			const pid = ch.dataset["pid"];
			if (!pid) continue;
			const slider = ch.querySelector<HTMLInputElement>("[data-gain]");
			if (slider) {
				this.on(slider, "input", () => {
					const gain = Number(slider.value) / 100;
					audioMixer.setGain(pid, gain);
				});
			}
			const muteBtn = ch.querySelector<HTMLButtonElement>("[data-mute]");
			if (muteBtn) {
				this.on(muteBtn, "click", () => {
					const next = !studio.state.participants[pid]?.muted;
					audioMixer.mute(pid, next);
					studio.updateParticipant(pid as Participant["id"], { muted: next });
				});
			}
		}
	}

	protected afterMount(): void {
		this.startTick();
	}

	protected beforeDestroy(): void {
		cancelAnimationFrame(this.raf);
	}

	protected update(): void {
		super.update();
		this.startTick();
	}

	private startTick(): void {
		cancelAnimationFrame(this.raf);
		const tick = (): void => {
			this.drawVUs();
			this.raf = requestAnimationFrame(tick);
		};
		this.raf = requestAnimationFrame(tick);
	}

	private drawVUs(): void {
		for (const ch of this.$$<HTMLElement>("[data-pid]")) {
			const pid = ch.dataset["pid"];
			const canvas = ch.querySelector<HTMLCanvasElement>("[data-vu]");
			if (!pid || !canvas) continue;
			const analyser = audioMixer.getAnalyser(pid);
			const ctx = canvas.getContext("2d");
			if (!ctx) continue;
			const w = canvas.width;
			const h = canvas.height;
			ctx.clearRect(0, 0, w, h);
			if (!analyser) continue;
			const bins = Math.min(SCRATCH.length, analyser.frequencyBinCount);
			analyser.getByteFrequencyData(SCRATCH);
			let sum = 0;
			for (let i = 0; i < bins; i++) sum += SCRATCH[i] ?? 0;
			const level = Math.min(1, (sum / bins / 255) * 2.2); // double-scale so a normal voice fills mid-bar
			const lit = Math.round(level * BAR_COUNT);
			const barH = (h - (BAR_COUNT - 1) * BAR_GAP) / BAR_COUNT;
			for (let i = 0; i < BAR_COUNT; i++) {
				const y = h - (i + 1) * (barH + BAR_GAP) + BAR_GAP;
				const isLit = i < lit;
				const color = isLit ? colorForBar(i) : "rgba(120,120,140,0.18)";
				ctx.fillStyle = color;
				ctx.fillRect(2, y, w - 4, barH);
			}
		}
	}
}

function colorForBar(i: number): string {
	// Bottom 60% green, next 25% amber, top 15% red.
	const ratio = i / BAR_COUNT;
	if (ratio < 0.6) return "#4ade80";
	if (ratio < 0.85) return "#fbbf24";
	return "#f87171";
}

function collectAudioable(participants: Record<string, Participant>): Participant[] {
	// Anyone with audio: cameras (might have mic paired), mics, agents.
	// Easiest: anyone who's been added to the mixer.
	return Object.values(participants).filter((p) => audioMixer.hasChannel(p.id) || p.kind === "voice" || p.kind === "voice-image" || p.kind === "voice-vrm" || p.kind === "voice-glb" || p.kind === "mic" || p.kind === "camera");
}
