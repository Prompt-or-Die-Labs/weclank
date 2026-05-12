// Static-image renderer — shows the agent's portrait and overlays a soft
// pulse driven by voice amplitude so the tile doesn't feel dead during
// speech.

import { bunRpc } from "../rpc";
import type { AgentRenderer, RendererContext } from "./renderer";
import type { Participant } from "../core/types";

export class ImageRenderer implements AgentRenderer {
	readonly kind = "voice-image" as const;
	private canvas: HTMLCanvasElement | null = null;
	private ctx2d: CanvasRenderingContext2D | null = null;
	private img: HTMLImageElement | null = null;
	private analyser: AnalyserNode | null = null;
	private data: Uint8Array<ArrayBuffer> | null = null;
	private raf = 0;
	/** Loopback preview token — cleared on detach via `unregisterRecordingPreview`. */
	private libraryPreviewToken: string | null = null;

	async attach(ctx: RendererContext, participant: Participant): Promise<void> {
		this.canvas = document.createElement("canvas");
		this.canvas.className = "renderer-canvas";
		this.canvas.width = 800;
		this.canvas.height = 800;
		ctx.host.appendChild(this.canvas);
		this.ctx2d = this.canvas.getContext("2d");
		this.analyser = ctx.analyser ?? null;
		if (this.analyser) this.data = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));

		const libPath = participant.visual?.libraryImagePath?.trim();
		const url = participant.visual?.imageUrl;
		if (libPath) {
			const reg = await bunRpc.registerMediaLibraryImagePreview({ path: libPath });
			if (!reg.ok || !reg.url || !reg.token) {
				throw new Error(reg.error ?? "Could not open library image preview");
			}
			this.libraryPreviewToken = reg.token;
			await new Promise<void>((resolve, reject) => {
				this.img = new Image();
				this.img.crossOrigin = "anonymous";
				this.img.onload = () => resolve();
				this.img.onerror = () => reject(new Error(`Failed to load library image`));
				this.img.src = reg.url!;
			});
		} else if (url) {
			await new Promise<void>((resolve, reject) => {
				this.img = new Image();
				this.img.crossOrigin = "anonymous";
				this.img.onload = () => resolve();
				this.img.onerror = () => reject(new Error(`Failed to load ${url}`));
				this.img.src = url;
			});
		}
		this.loop();
		ctx.onReady?.();
	}

	update(_p: Participant): void {
		// If the participant.visual.imageUrl changes, the tile recreates the
		// renderer; no in-place swap needed for the scaffold.
	}

	detach(): void {
		cancelAnimationFrame(this.raf);
		if (this.libraryPreviewToken) {
			void bunRpc.unregisterRecordingPreview({ token: this.libraryPreviewToken }).catch(() => {});
			this.libraryPreviewToken = null;
		}
		this.canvas?.remove();
		this.canvas = null;
		this.ctx2d = null;
		this.img = null;
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

		ctx.fillStyle = "#0a0a0a";
		ctx.fillRect(0, 0, width, height);

		// voice amplitude (0..1)
		let amp = 0;
		if (this.analyser && this.data) {
			this.analyser.getByteFrequencyData(this.data);
			for (let i = 0; i < this.data.length; i++) amp += this.data[i] ?? 0;
			amp = (amp / this.data.length) / 255;
		}

		const pulse = 1 + amp * 0.06;
		if (this.img && this.img.complete) {
			const iw = this.img.naturalWidth;
			const ih = this.img.naturalHeight;
			const scale = Math.min(width / iw, height / ih) * pulse;
			const dw = iw * scale;
			const dh = ih * scale;
			ctx.drawImage(this.img, (width - dw) / 2, (height - dh) / 2, dw, dh);
		} else {
			// fallback: voice ring
			ctx.fillStyle = `rgba(255,255,255,${0.05 + amp * 0.2})`;
			ctx.beginPath();
			ctx.arc(width / 2, height / 2, Math.min(width, height) / 3 * pulse, 0, Math.PI * 2);
			ctx.fill();
		}
	};
}
