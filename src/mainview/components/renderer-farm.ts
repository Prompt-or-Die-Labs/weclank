// Renderer farm — hidden offscreen host where every participant's renderer
// lives. Renderers need a DOM host (a <video> element for cameras, a
// three.js <canvas> for VRM/GLB) to do their work, but in the new
// canvas-as-preview model those hosts are NEVER visible. The user sees
// only the composited program canvas (mounted by StreamEngine into the
// stage).
//
// The farm:
//   - mounts one off-screen host div at app boot
//   - on participant add/update, creates/reuses a renderer keyed by id
//   - on participant remove, the studio store's cleanup callback tears
//     down the renderer; this module exposes `dispose(id)` for that path
//   - exposes a single `getRenderer(id)` for the StreamEngine's
//     `setRendererProvider` lookup
//
// Renderer signatures (kind|modelUrl|imageUrl|videoDeviceId) trigger a
// rebuild when an asset changes; otherwise a participant update just
// re-invokes `renderer.update(participant)` cheaply.

import type { Participant } from "../core/types";
import { createRenderer, type AgentRenderer } from "../renderers";
import { studio } from "../state/studio-store";

interface Entry {
	renderer: AgentRenderer;
	signature: string;
	host: HTMLElement;
}

class RendererFarm {
	private rootHost: HTMLElement | null = null;
	private entries = new Map<string, Entry>();
	private unsubscribe: (() => void) | null = null;

	/** Mount the hidden host once. Idempotent. */
	mount(parent: HTMLElement = document.body): void {
		if (this.rootHost) return;
		const host = document.createElement("div");
		host.className = "renderer-farm";
		// Off-screen but rendered — renderers need real layout to function.
		host.style.position = "fixed";
		host.style.left = "-10000px";
		host.style.top = "0";
		host.style.width = "1280px";
		host.style.height = "720px";
		host.style.pointerEvents = "none";
		host.style.opacity = "0";
		host.style.overflow = "hidden";
		parent.appendChild(host);
		this.rootHost = host;
		this.subscribeToParticipantUpdates();
	}

	/** Watch the store for participant adds / updates and call
	 * `ensureRenderer` for each. Without this, updates to an existing
	 * participant (e.g. the host toggling `cameraOff: false` from the
	 * stage toolbar) never reach the renderer, so `getUserMedia` is
	 * never invoked and the webcam never turns on.
	 *
	 * Removals are handled separately via `participantRuntime.dispose`
	 * — no diff needed here. */
	private subscribeToParticipantUpdates(): void {
		if (this.unsubscribe) return;
		let prev = studio.state.participants;
		this.unsubscribe = studio.select(
			(s) => s.participants,
			(next) => {
				for (const participant of Object.values(next)) {
					if (prev[participant.id] === participant) continue;
					void this.ensureRenderer(participant).catch((err) => {
						console.warn("[renderer-farm] ensureRenderer failed", participant.id, err);
					});
				}
				prev = next;
			},
		);
	}

	/** Look up the renderer for a participant. The StreamEngine calls this
	 * once per composite frame; must stay cheap. */
	getRenderer(participantId: string): AgentRenderer | undefined {
		return this.entries.get(participantId)?.renderer;
	}

	/** Create or reattach the renderer for `participant`. Caller is whoever
	 * adds/updates the participant — typically `source-factory` after
	 * adding to the store, and the per-tile mount path before CP3 retires
	 * ParticipantTile. Safe to call repeatedly; only rebuilds when the
	 * renderer signature changes. */
	async ensureRenderer(participant: Participant): Promise<void> {
		if (!this.rootHost) this.mount();
		const root = this.rootHost!;
		const id = participant.id;
		const sig = rendererSignature(participant);
		const existing = this.entries.get(id);
		if (existing && existing.signature === sig) {
			existing.renderer.update(participant);
			return;
		}
		if (existing) {
			existing.renderer.detach();
			existing.host.remove();
			this.entries.delete(id);
		}
		const host = document.createElement("div");
		host.className = "renderer-farm__slot";
		host.style.width = "100%";
		host.style.height = "100%";
		root.appendChild(host);
		const renderer = createRenderer(participant.kind);
		const analyser = (await import("../streaming/audio-mixer")).audioMixer.getAnalyser(id);
		try {
			await renderer.attach({ host, analyser: analyser ?? undefined }, participant);
			this.entries.set(id, { renderer, signature: sig, host });
		} catch (err) {
			host.remove();
			throw err;
		}
	}

	/** Tear down a participant's renderer. Idempotent. */
	dispose(participantId: string): void {
		const entry = this.entries.get(participantId);
		if (!entry) return;
		try {
			entry.renderer.detach();
		} catch (err) {
			console.warn("[renderer-farm] detach failed", participantId, err);
		}
		entry.host.remove();
		this.entries.delete(participantId);
	}

	/** Replay current participants into the farm — call once at boot
	 * after persistence restores so prior agents/cameras get renderers
	 * even before any UI mounts. */
	async hydrate(): Promise<void> {
		for (const p of Object.values(studio.state.participants)) {
			try {
				await this.ensureRenderer(p);
			} catch (err) {
				studio.removeParticipant(p.id);
				const { toast } = await import("./overlays");
				const { userMessageFor } = await import("../core/errors");
				toast(`Couldn't restore ${p.displayName}: ${userMessageFor(err)}`, "error");
			}
		}
	}
}

function rendererSignature(p: Participant): string {
	return [
		p.kind,
		p.visual?.modelUrl ?? "",
		p.visual?.imageUrl ?? "",
		p.visual?.libraryImagePath ?? "",
		p.videoDeviceId ?? "",
	].join("|");
}

export const rendererFarm = new RendererFarm();
