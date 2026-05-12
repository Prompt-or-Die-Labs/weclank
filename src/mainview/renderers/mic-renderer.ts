// Mic / audio-only renderer. The "connects like a normal user" entry point
// for external-voice agents — agent process pipes audio into a virtual
// audio device (BlackHole on macOS, VB-Audio on Windows, PulseAudio loopback
// on Linux), and the studio user picks that device here.
//
// Visually the tile shows a reactive equalizer keyed off the mic's
// amplitude (same routine as VoiceRenderer) so the speaker isn't a black
// box. The MediaStream is registered with the audio mixer so the speaking
// ring + lip-sync (if a VRM/GLB pair is added later) react to it.

import type { AgentRenderer, RendererContext } from "./renderer";
import type { Participant } from "../core/types";
import { audioMixer } from "../streaming/audio-mixer";

const BAR_COUNT = 28;

export class MicRenderer implements AgentRenderer {
	readonly kind = "mic" as const;
	private canvas: HTMLCanvasElement | null = null;
	private ctx2d: CanvasRenderingContext2D | null = null;
	private analyser: AnalyserNode | null = null;
	private data: Uint8Array<ArrayBuffer> | null = null;
	private stream: MediaStream | null = null;
	private deviceLabel = "";
	private raf = 0;

	async attach(ctx: RendererContext, participant: Participant): Promise<void> {
		this.canvas = document.createElement("canvas");
		this.canvas.className = "renderer-canvas";
		this.canvas.width = 800;
		this.canvas.height = 800;
		ctx.host.appendChild(this.canvas);
		this.ctx2d = this.canvas.getContext("2d");

		try {
			// participant.mediaStream takes precedence when the source-factory
			// already negotiated a stream (e.g. user picked a specific
			// deviceId at creation time). Falls back to the system default
			// mic so the tile is functional immediately.
			this.stream = participant.mediaStream
				?? (await navigator.mediaDevices.getUserMedia({ audio: true, video: false }));
			this.deviceLabel = this.stream.getAudioTracks()[0]?.label ?? "Microphone";
			// Routing through the mixer gives us a stable analyser and
			// feeds the speaking-ring loop in the tool rail.
			this.analyser = audioMixer.addInput(participant.id, this.stream);
			this.data = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
		} catch (err) {
			console.warn("[MicRenderer] mic capture failed", err);
			this.deviceLabel = "Microphone unavailable";
		}

		this.loop();
		ctx.onReady?.();
	}

	update(_p: Participant): void {}

	detach(): void {
		cancelAnimationFrame(this.raf);
		this.stream?.getTracks().forEach((t) => t.stop());
		this.stream = null;
		this.analyser = null;
		this.data = null;
		this.canvas?.remove();
		this.canvas = null;
		this.ctx2d = null;
	}

	getFrameSource(): CanvasImageSource | null {
		return this.canvas;
	}

	private loop = (): void => {
		this.raf = requestAnimationFrame(this.loop);
		const ctx = this.ctx2d;
		const canvas = this.canvas;
		if (!ctx || !canvas) return;
		const { width, height } = canvas;

		const grad = ctx.createRadialGradient(width / 2, height / 2, 60, width / 2, height / 2, width / 1.4);
		grad.addColorStop(0, "#1c1c22");
		grad.addColorStop(1, "#0a0a0b");
		ctx.fillStyle = grad;
		ctx.fillRect(0, 0, width, height);

		if (this.analyser && this.data) this.analyser.getByteFrequencyData(this.data);

		// Horizontal equalizer bars centered vertically
		const barW = width / (BAR_COUNT * 1.6);
		const gap = barW * 0.6;
		const totalW = BAR_COUNT * barW + (BAR_COUNT - 1) * gap;
		const startX = (width - totalW) / 2;
		const baseY = height / 2;
		for (let i = 0; i < BAR_COUNT; i++) {
			const idx = this.data ? Math.floor((i / BAR_COUNT) * this.data.length) : 0;
			const sample = this.data?.[idx] ?? 10;
			const v = sample / 255;
			const h = Math.max(barW, v * height * 0.55);
			const x = startX + i * (barW + gap);
			ctx.fillStyle = `hsl(${190 + i * 5}, 80%, ${48 + v * 32}%)`;
			ctx.fillRect(x, baseY - h / 2, barW, h);
		}

		// Device label
		ctx.fillStyle = "rgba(255,255,255,0.55)";
		ctx.font = '500 24px -apple-system, "SF Mono", system-ui';
		ctx.textAlign = "center";
		ctx.fillText(this.deviceLabel.slice(0, 40), width / 2, height - 64);
	};
}
