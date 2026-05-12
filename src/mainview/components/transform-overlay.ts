// Transform overlay — the DOM layer above the program canvas that handles
// source selection, drag-to-move, drag-to-resize, and the visible selection
// outline + handles. Pointer events live on this layer so the canvas itself
// stays untouched (it's just a paint surface).
//
// Coordinate model:
//   - The canvas pixel buffer is at the stream preset's resolution
//     (1280×720 for 720p, etc.). Stored placements are 0..1 ratios.
//   - The DOM element this overlay sits in is whatever size the layout
//     gave it — could be 800×450, 1200×675, anything. `getBoundingClientRect`
//     translates pointer coords into canvas-pixel space.
//
// Handles:
//   nw  n  ne          n=top-center
//   w   .   e
//   sw  s  se
//
// Modifiers:
//   Shift  — corner resize preserves aspect ratio
//   Alt    — resize from center (both opposing edges move)
//   Esc    — deselect

import { Component } from "../core/component";
import { studio } from "../state/studio-store";
import type { ParticipantId } from "../core/ids";
import type { SourcePlacement, Scene } from "../core/types";
import {
	movePlacement,
	resizePlacement,
	topmostSourceAt,
	type ResizeHandle,
} from "../state/scene-composition";

type HandleKind = ResizeHandle;

interface DragState {
	mode: "move" | HandleKind;
	startMouseX: number;
	startMouseY: number;
	startPlacement: SourcePlacement;
}

interface State {
	scene: Scene;
	selectedId: ParticipantId | null;
}

const HANDLE_KINDS: HandleKind[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export class TransformOverlay extends Component<State> {
	private drag: DragState | null = null;
	private rafHandle = 0;
	private resizeObserver: ResizeObserver | null = null;

	constructor() {
		const scene = studio.activeScene;
		super({ scene, selectedId: null });
		studio.select(
			(s) => s.scenes.find((sc) => sc.id === s.activeSceneId),
			(scene) => {
				if (scene) {
					this.setState({ scene });
				}
			},
		);
		studio.select(
			(s) => s.activeSceneId,
			() => this.setState({ selectedId: null }),
		);
	}

	protected rootClass(): string {
		return "transform-overlay";
	}

	protected template(): string {
		return `<div class="transform-overlay__inner" data-inner></div>`;
	}

	protected afterMount(): void {
		// Re-render the selection ring whenever the canvas (and therefore
		// the overlay) resizes — side rails toggling will change pixel
		// dimensions and ratio-based math needs a fresh BCR.
		this.resizeObserver = new ResizeObserver(() => this.renderSelection());
		this.resizeObserver.observe(this.el);

		this.on(this.el, "pointerdown", (e) => this.onPointerDown(e as PointerEvent));
		this.on(window, "pointermove", (e) => this.onPointerMove(e as PointerEvent));
		this.on(window, "pointerup", (e) => this.onPointerUp(e as PointerEvent));
		this.on(window, "keydown", (e) => this.onKey(e as KeyboardEvent));

		this.startTick();
	}

	protected beforeDestroy(): void {
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		cancelAnimationFrame(this.rafHandle);
	}

	protected update(): void {
		super.update();
		this.renderSelection();
	}

	private startTick(): void {
		const loop = (): void => {
			this.renderSelection();
			this.rafHandle = requestAnimationFrame(loop);
		};
		this.rafHandle = requestAnimationFrame(loop);
	}

	/** Repaint the selection box + handles in DOM coordinates. Cheap —
	 * just sets CSS on a small fixed number of elements. */
	private renderSelection(): void {
		const inner = this.$<HTMLElement>("[data-inner]");
		if (!inner) return;
		const sel = this.state.selectedId;
		if (!sel) {
			inner.innerHTML = "";
			return;
		}
		const placement = this.state.scene.sources.find((p) => p.participantId === sel);
		if (!placement) {
			inner.innerHTML = "";
			return;
		}
		const rect = this.el.getBoundingClientRect();
		const x = placement.x * rect.width;
		const y = placement.y * rect.height;
		const w = placement.w * rect.width;
		const h = placement.h * rect.height;
		inner.innerHTML = `
			<div class="transform-overlay__box" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;">
				${HANDLE_KINDS.map((k) => `<div class="transform-overlay__handle transform-overlay__handle--${k}" data-handle="${k}"></div>`).join("")}
			</div>
		`;
	}

	private onPointerDown(e: PointerEvent): void {
		const target = e.target as HTMLElement;
		const handle = target.closest<HTMLElement>("[data-handle]");
		if (handle && this.state.selectedId) {
			const placement = this.state.scene.sources.find((p) => p.participantId === this.state.selectedId);
			if (!placement) return;
			const kind = handle.dataset["handle"] as HandleKind;
			this.drag = {
				mode: kind,
				startMouseX: e.clientX,
				startMouseY: e.clientY,
				startPlacement: { ...placement },
			};
			(e.currentTarget as Element).setPointerCapture?.(e.pointerId);
			e.preventDefault();
			return;
		}
		const { x: cx, y: cy } = this.clientToRatio(e.clientX, e.clientY);
		const hit = topmostSourceAt(this.state.scene, cx, cy);
		if (hit) {
			this.setState({ selectedId: hit.participantId });
			this.drag = {
				mode: "move",
				startMouseX: e.clientX,
				startMouseY: e.clientY,
				startPlacement: { ...hit },
			};
			(e.currentTarget as Element).setPointerCapture?.(e.pointerId);
			e.preventDefault();
			return;
		}
		// Clicked empty canvas — deselect.
		this.setState({ selectedId: null });
	}

	private onPointerMove(e: PointerEvent): void {
		if (!this.drag || !this.state.selectedId) return;
		const rect = this.el.getBoundingClientRect();
		const dxRatio = (e.clientX - this.drag.startMouseX) / rect.width;
		const dyRatio = (e.clientY - this.drag.startMouseY) / rect.height;
		const start = this.drag.startPlacement;
		let next: Partial<SourcePlacement> = {};
		if (this.drag.mode === "move") {
			next = movePlacement(start, dxRatio, dyRatio);
		} else {
			next = resizePlacement(this.drag.mode, start, dxRatio, dyRatio, e.shiftKey, e.altKey);
		}
		studio.updateSourcePlacement(this.state.scene.id, this.state.selectedId, next);
	}

	private onPointerUp(e: PointerEvent): void {
		if (!this.drag) return;
		this.drag = null;
		(e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
	}

	private clientToRatio(clientX: number, clientY: number): { x: number; y: number } {
		const rect = this.el.getBoundingClientRect();
		return {
			x: (clientX - rect.left) / rect.width,
			y: (clientY - rect.top) / rect.height,
		};
	}

	private onKey(e: KeyboardEvent): void {
		// Skip if the user is typing in a field somewhere.
		const t = e.target;
		if (t instanceof HTMLElement) {
			if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
		}
		if (e.key === "Escape") {
			this.setState({ selectedId: null });
			return;
		}
		if (!this.state.selectedId) return;
		const arrow = arrowDelta(e.key);
		if (!arrow) return;
		e.preventDefault();
		const step = e.shiftKey ? 0.02 : 0.002; // shift = 2% of canvas, ~20px at 1080p
		const placement = this.state.scene.sources.find((p) => p.participantId === this.state.selectedId);
		if (!placement) return;
		studio.updateSourcePlacement(this.state.scene.id, this.state.selectedId, movePlacement(placement, arrow.dx * step, arrow.dy * step));
	}
}

function arrowDelta(key: string): { dx: number; dy: number } | null {
	switch (key) {
		case "ArrowLeft":  return { dx: -1, dy: 0 };
		case "ArrowRight": return { dx: 1, dy: 0 };
		case "ArrowUp":    return { dx: 0, dy: -1 };
		case "ArrowDown":  return { dx: 0, dy: 1 };
		default: return null;
	}
}
