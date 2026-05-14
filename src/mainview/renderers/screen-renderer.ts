// Screen renderer — getDisplayMedia. Availability differs between WKWebView
// (macOS) and CEF (Linux), so we feature-detect and surface a clean error.

import type { AgentRenderer, RendererContext } from "./renderer";
import type { Participant } from "../core/types";
import { RendererError } from "../core/errors";

export class ScreenRenderer implements AgentRenderer {
	readonly kind = "screen" as const;
	private video: HTMLVideoElement | null = null;
	private stream: MediaStream | null = null;

	async attach(ctx: RendererContext, participant: Participant): Promise<void> {
		this.video = document.createElement("video");
		this.video.autoplay = true;
		this.video.playsInline = true;
		this.video.muted = true;
		this.video.className = "renderer-video";
		ctx.host.appendChild(this.video);

		this.stream = participant.mediaStream ?? await this.captureScreen();
		this.video.srcObject = this.stream;
		await new Promise<void>((resolve) => {
			if (!this.video) {
				resolve();
				return;
			}
			if (this.video.readyState >= 1) {
				resolve();
				return;
			}
			this.video.onloadedmetadata = () => resolve();
		});
		await this.video.play().catch((err) => {
			throw new RendererError(
				`Screen capture video failed to play: ${err instanceof Error ? err.message : String(err)}`,
				"Screen capture started, but the preview could not play. Try adding the screen source again.",
			);
		});
		ctx.onReady?.();
	}

	private async captureScreen(): Promise<MediaStream> {
		const md = navigator.mediaDevices as MediaDevices & {
			getDisplayMedia?: (c?: DisplayMediaStreamOptions) => Promise<MediaStream>;
		};
		if (!md?.getDisplayMedia) {
			throw new RendererError(
				"getDisplayMedia not available in this webview",
				"Screen capture isn't supported in this build. On Linux this works in the CEF runtime; on macOS WKWebView requires the screen-recording entitlement.",
			);
		}
		window.focus();
		return md.getDisplayMedia({ video: true, audio: false });
	}

	update(_participant: Participant): void {
		// no-op for now
	}

	detach(): void {
		this.stream?.getTracks().forEach((t) => t.stop());
		this.stream = null;
		this.video?.remove();
		this.video = null;
	}

	getFrameSource(): CanvasImageSource | null {
		return this.video;
	}
}
