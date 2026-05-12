// StageCanvas — the visible program canvas. This is the same canvas the
// StreamEngine composites onto and the same one MediaRecorder captures
// for RTMP, so the preview IS the broadcast (WYSIWYG, OBS-style).
//
// The DOM tree is:
//   .stage-canvas__frame  (aspect-ratio: 16/9, max-width, centered)
//     <canvas>             (mounted by streamEngine.mount)
//     <div data-empty>     (instructional overlay when the active scene
//                           has no visible sources — hidden via CSS once
//                           sources appear)
//     <div data-overlay>   (transform-overlay mounts here)

import { Component } from "../core/component";
import { studio } from "../state/studio-store";
import { streamEngine } from "../streaming/stream-engine";
import { rendererFarm } from "./renderer-farm";
import type { Scene } from "../core/types";

interface State {
	scene: Scene;
}

export class StageCanvas extends Component<State> {
	constructor() {
		super({ scene: studio.activeScene });
		studio.select(
			(s) => s.scenes.find((sc) => sc.id === s.activeSceneId),
			(scene) => { if (scene) this.setState({ scene }); },
		);
		// Cross-fade transition on scene switch — engine handles the fade,
		// we just trigger it on activeSceneId change.
		studio.select(
			(s) => s.activeSceneId,
			() => streamEngine.triggerSceneTransition(300),
		);
	}

	protected rootClass(): string {
		return "stage-canvas";
	}

	protected template(): string {
		// Template is rendered once. Empty-state visibility is managed via
		// DOM mutation in `update()` so we never tear down the StreamEngine
		// canvas that was mounted into [data-frame] in afterMount().
		return `
			<div class="stage-canvas__frame" data-frame>
				<div class="stage-canvas__empty" data-empty hidden>
					<div class="stage-canvas__empty-title" data-empty-title></div>
					<div class="stage-canvas__empty-hint">Add a camera, screen capture, or AI co-host from the <kbd>+</kbd> button above.</div>
				</div>
				<div class="stage-canvas__overlay" data-overlay></div>
			</div>
		`;
	}

	protected afterMount(): void {
		const frame = this.$<HTMLElement>("[data-frame]");
		if (frame) streamEngine.mount(frame);
		streamEngine.setRendererProvider((id) => rendererFarm.getRenderer(id));
		streamEngine.start();
		this.refreshEmptyState();
	}

	protected update(): void {
		// Don't re-render the template — that would blow away the canvas
		// child mounted by StreamEngine. Just refresh empty-state DOM.
		this.refreshEmptyState();
	}

	private refreshEmptyState(): void {
		const empty = this.$<HTMLElement>("[data-empty]");
		const title = this.$<HTMLElement>("[data-empty-title]");
		if (!empty || !title) return;
		const hasVisible = this.state.scene.sources.some((s) => s.visible);
		empty.hidden = hasVisible;
		if (!hasVisible) {
			title.innerHTML = `No sources in <strong>${escapeText(this.state.scene.name)}</strong>`;
		}
	}

	/** The DOM node that transform-overlay should mount into. Looked up
	 * fresh each call so it survives `update()` re-renders. */
	getOverlayHost(): HTMLElement | null {
		return this.$<HTMLElement>("[data-overlay]");
	}
}

function escapeText(s: string): string {
	return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c] ?? c);
}
