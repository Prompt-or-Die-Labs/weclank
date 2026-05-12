// Voice-only renderer — no image, no model. Draws a reactive equalizer that
// dances to the incoming audio analyser. The participant name still renders
// via the LowerThird overlay; this canvas is the "face".

import type { AgentRenderer, RendererContext } from "./renderer";
import type { Participant } from "../core/types";

const BAR_COUNT = 32;

export class VoiceRenderer implements AgentRenderer {
	readonly kind = "voice" as const;
	private canvas: HTMLCanvasElement | null = null;
	private ctx2d: CanvasRenderingContext2D | null = null;
	private analyser: AnalyserNode | null = null;
	private data: Uint8Array<ArrayBuffer> | null = null;
	private raf = 0;
	private hue = 280;

	async attach(ctx: RendererContext, _participant: Participant): Promise<void> {
		this.canvas = document.createElement("canvas");
		this.canvas.className = "renderer-canvas";
		this.canvas.width = 800;
		this.canvas.height = 800;
		ctx.host.appendChild(this.canvas);
		this.ctx2d = this.canvas.getContext("2d");

		this.analyser = ctx.analyser ?? null;
		if (this.analyser) {
			this.data = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
		}
		this.loop();
		ctx.onReady?.();
	}

	update(_p: Participant): void {}

	detach(): void {
		cancelAnimationFrame(this.raf);
		this.canvas?.remove();
		this.canvas = null;
		this.ctx2d = null;
		this.analyser = null;
		this.data = null;
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
		// background gradient
		const grad = ctx.createRadialGradient(width / 2, height / 2, 50, width / 2, height / 2, width / 1.4);
		grad.addColorStop(0, `hsl(${this.hue}, 60%, 18%)`);
		grad.addColorStop(1, "#0a0a0a");
		ctx.fillStyle = grad;
		ctx.fillRect(0, 0, width, height);

		if (this.analyser && this.data) this.analyser.getByteFrequencyData(this.data);

		// radial equalizer
		const cx = width / 2;
		const cy = height / 2;
		const radius = Math.min(width, height) * 0.28;
		for (let i = 0; i < BAR_COUNT; i++) {
			const idx = this.data ? Math.floor((i / BAR_COUNT) * this.data.length) : 0;
			const v = (this.data?.[idx] ?? 12) / 255;
			const angle = (i / BAR_COUNT) * Math.PI * 2 - Math.PI / 2;
			const len = radius * (0.25 + v * 0.9);
			const x1 = cx + Math.cos(angle) * radius;
			const y1 = cy + Math.sin(angle) * radius;
			const x2 = cx + Math.cos(angle) * (radius + len);
			const y2 = cy + Math.sin(angle) * (radius + len);
			ctx.strokeStyle = `hsl(${this.hue + i * 4}, 80%, ${50 + v * 30}%)`;
			ctx.lineWidth = 6;
			ctx.lineCap = "round";
			ctx.beginPath();
			ctx.moveTo(x1, y1);
			ctx.lineTo(x2, y2);
			ctx.stroke();
		}

		this.hue = (this.hue + 0.2) % 360;
	};
}
