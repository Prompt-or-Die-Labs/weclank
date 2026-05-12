// Camera renderer — getUserMedia. Stays in a "stopped" state when the
// participant has `cameraOff: true` so the studio never triggers a
// permission prompt at startup. The user starts the camera explicitly via
// the dock toggle, which flips cameraOff and re-calls update().

import type { AgentRenderer, RendererContext } from "./renderer";
import type { Participant } from "../core/types";
import { escapeHtml } from "../components/primitives";

export class CameraRenderer implements AgentRenderer {
	readonly kind = "camera" as const;
	private video: HTMLVideoElement | null = null;
	private placeholder: HTMLElement | null = null;
	private stream: MediaStream | null = null;
	private starting = false;
	private lastParticipant: Participant | null = null;

	async attach(ctx: RendererContext, participant: Participant): Promise<void> {
		this.lastParticipant = participant;
		this.video = document.createElement("video");
		this.video.autoplay = true;
		this.video.playsInline = true;
		this.video.muted = true;
		this.video.className = "renderer-video";
		ctx.host.appendChild(this.video);

		this.placeholder = document.createElement("div");
		this.placeholder.className = "renderer-placeholder";
		this.placeholder.innerHTML = this.placeholderMarkup(participant);
		ctx.host.appendChild(this.placeholder);

		if (participant.mediaStream) {
			this.stream = participant.mediaStream;
			this.video.srcObject = this.stream;
		}
		this.updateVisibility(participant);
		ctx.onReady?.();
	}

	update(participant: Participant): void {
		this.lastParticipant = participant;
		if (this.placeholder) this.placeholder.innerHTML = this.placeholderMarkup(participant);
		this.updateVisibility(participant);
		if (!participant.cameraOff && !this.stream && !this.starting) {
			void this.startStream();
		}
		if (participant.cameraOff && this.stream) {
			this.stopStream();
		}
	}

	detach(): void {
		this.stopStream();
		this.video?.remove();
		this.placeholder?.remove();
		this.video = null;
		this.placeholder = null;
	}

	getFrameSource(): CanvasImageSource | null {
		return this.stream ? this.video : null;
	}

	private async startStream(): Promise<void> {
		if (!this.video) return;
		this.starting = true;
		try {
			const constraints: MediaStreamConstraints = { audio: false };
			const video: MediaTrackConstraints = { width: { ideal: 1280 }, height: { ideal: 720 } };
			if (this.lastParticipant?.videoDeviceId) {
				video.deviceId = { exact: this.lastParticipant.videoDeviceId };
			}
			constraints.video = video;
			this.stream = await navigator.mediaDevices.getUserMedia(constraints);
			this.video.srcObject = this.stream;
			this.updateVisibility({ cameraOff: false } as Participant);
		} catch (err) {
			console.warn("[CameraRenderer] failed to start camera", err);
		} finally {
			this.starting = false;
		}
	}

	private stopStream(): void {
		this.stream?.getTracks().forEach((t) => t.stop());
		this.stream = null;
		if (this.video) this.video.srcObject = null;
	}

	private updateVisibility(p: Pick<Participant, "cameraOff">): void {
		if (!this.video || !this.placeholder) return;
		const off = p.cameraOff || !this.stream;
		this.video.style.display = off ? "none" : "block";
		this.placeholder.style.display = off ? "flex" : "none";
	}

	private placeholderMarkup(p: Participant): string {
		const initial = (p.displayName[0] ?? "?").toUpperCase();
		return `
			<div class="renderer-placeholder__avatar">${escapeHtml(initial)}</div>
			<div class="renderer-placeholder__label">${p.cameraOff ? "Camera off" : "Camera not started"}</div>
		`;
	}
}
