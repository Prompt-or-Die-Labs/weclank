// Stream engine — composites the active scene's participant tiles onto a
// single canvas at a fixed cadence. The resulting canvas is the source for:
//   - MediaRecorder (local recording)
//   - WebRTC publish (future)
//   - Any RTMP egress driven from the Bun side (future)
//
// The engine doesn't know about React/components; it reads the studio store
// and asks each participant's renderer for its current frame. The frame
// sources are CanvasImageSource (video / canvas) so drawImage handles them
// uniformly.

import { studio } from "../state/studio-store";
import type { AgentRenderer } from "../renderers/renderer";
import { audioMixer } from "./audio-mixer";
import { PRESETS } from "./presets";
import { drawBroadcastOverlayPlane } from "./overlay-plane";
import { AudioError } from "../core/errors";

export class StreamEngine {
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;
	private raf = 0;
	private rendererProvider: (participantId: string) => AgentRenderer | undefined = () => undefined;
	// Cadence throttle: ~30fps is overkill for static scenes. Drop the
	// compositor to the preset's fps; viewers see the same thing and the
	// CPU saves a meaningful slice.
	private targetFrameInterval = 1000 / PRESETS["720p"].fps;
	private lastDrawAt = 0;
	// Rolling-window FPS measurement for the perf HUD.
	private drawTimestamps: number[] = [];
	// Scene-transition fade: animates a black overlay from opacity 1 → 0
	// after a scene change so the broadcast cross-fades through black
	// instead of cutting instantly.
	private transitionUntil = 0;
	private transitionDurationMs = 300;

	constructor(width = PRESETS["720p"].width, height = PRESETS["720p"].height) {
		this.canvas = document.createElement("canvas");
		this.canvas.width = width;
		this.canvas.height = height;
		const ctx = this.canvas.getContext("2d");
		if (!ctx) throw new AudioError("2D canvas context unavailable", "This webview can't open a 2D drawing context. Stream compositing won't work.");
		this.ctx = ctx;
		// CSS lets the canvas fit its host's box at the preset aspect ratio.
		// Stretch handled by `object-fit: contain` plus the host element's
		// aspect-ratio styling so the underlying pixel buffer (1280×720 or
		// 1920×1080) stays correct regardless of display size.
		this.canvas.style.display = "block";
		this.canvas.style.width = "100%";
		this.canvas.style.height = "100%";
		this.canvas.style.background = "#000";
	}

	/** Attach the program canvas into a DOM host so it's visible. The same
	 * canvas is what `captureStream()` feeds to MediaRecorder for RTMP, so
	 * WYSIWYG: the user's preview IS the broadcast. */
	mount(host: HTMLElement): void {
		if (this.canvas.parentElement !== host) {
			host.appendChild(this.canvas);
		}
	}

	/** Direct access to the composited DOM canvas. CanvasOverlay reads
	 * `getBoundingClientRect()` from this to translate pointer events
	 * into canvas-pixel space. */
	get canvasEl(): HTMLCanvasElement {
		return this.canvas;
	}

	/** Resize the composite canvas. Call this between Go Live sessions —
	 * resizing mid-stream confuses MediaRecorder. */
	setResolution(width: number, height: number): void {
		this.canvas.width = width;
		this.canvas.height = height;
	}

	/** Target frame rate. rAF still ticks at the display refresh but we
	 * skip redraws below this rate to save the per-frame `drawImage`
	 * cost — only meaningful when participant content is mostly static. */
	setTargetFps(fps: number): void {
		this.targetFrameInterval = 1000 / Math.max(1, fps);
	}

	/** Trigger a fade-through-black transition. Called when the active
	 * scene changes so the broadcast doesn't hard-cut. */
	triggerSceneTransition(durationMs = 300): void {
		this.transitionDurationMs = durationMs;
		this.transitionUntil = performance.now() + durationMs;
	}

	/** Wire up the renderer lookup. ParticipantTile owns renderer instances. */
	setRendererProvider(fn: (participantId: string) => AgentRenderer | undefined): void {
		this.rendererProvider = fn;
	}

	start(): void {
		if (this.raf) return;
		const tick = (now: number): void => {
			if (now - this.lastDrawAt >= this.targetFrameInterval) {
				this.draw();
				this.lastDrawAt = now;
				this.drawTimestamps.push(now);
				// Window: last 2 seconds. Old entries fall off.
				const cutoff = now - 2_000;
				while (this.drawTimestamps[0] !== undefined && this.drawTimestamps[0] < cutoff) {
					this.drawTimestamps.shift();
				}
			}
			this.raf = requestAnimationFrame(tick);
		};
		this.raf = requestAnimationFrame(tick);
	}

	/** Measured composite FPS over the last ~2 seconds. */
	measuredFps(): number {
		if (this.drawTimestamps.length < 2) return 0;
		const first = this.drawTimestamps[0]!;
		const last = this.drawTimestamps[this.drawTimestamps.length - 1]!;
		const span = (last - first) / 1000;
		return span > 0 ? (this.drawTimestamps.length - 1) / span : 0;
	}

	stop(): void {
		cancelAnimationFrame(this.raf);
		this.raf = 0;
	}

	getOutputStream(fps = 30): MediaStream {
		const video = (this.canvas as HTMLCanvasElement & { captureStream(fps?: number): MediaStream });
		const stream = video.captureStream(fps);
		const audio = audioMixer.outputStream.getAudioTracks()[0];
		if (audio) stream.addTrack(audio);
		return stream;
	}

	private draw(): void {
		const scene = studio.activeScene;
		const W = this.canvas.width;
		const H = this.canvas.height;

		this.ctx.fillStyle = "#000";
		this.ctx.fillRect(0, 0, W, H);

		// Sources draw bottom-to-top: array order IS z-order, last on top.
		for (const s of scene.sources) {
			if (!s.visible) continue;
			const renderer = this.rendererProvider(s.participantId);
			const source = renderer?.getFrameSource();
			if (!source) continue;
			try {
				this.ctx.drawImage(source, s.x * W, s.y * H, s.w * W, s.h * H);
			} catch {
				// Some sources throw if not ready yet (video before metadata).
			}
		}

		drawBroadcastOverlayPlane(this.ctx, W, H);

		// Scene transition fade — drawn last so it darkens everything,
		// then ramps to transparent over `transitionDurationMs`.
		const now = performance.now();
		if (this.transitionUntil > now) {
			const remaining = this.transitionUntil - now;
			const alpha = Math.min(1, remaining / this.transitionDurationMs);
			this.ctx.save();
			this.ctx.globalAlpha = alpha;
			this.ctx.fillStyle = "#000";
			this.ctx.fillRect(0, 0, W, H);
			this.ctx.restore();
		}
	}
}

export const streamEngine = new StreamEngine();
