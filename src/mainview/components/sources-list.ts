// Sources list — the bottom half of the left rail. Lists the active
// scene's source placements in z-order (TOP of list = TOP of canvas).
//
// Each row:
//   - drag handle (reorder = changes z-order via moveSourceUp/Down)
//   - kind icon
//   - participant name
//   - eye toggle (visibility)
//   - kebab menu (remove / send-to-back / bring-to-front / center / fit)
//
// Click a row → selects the source in the transform overlay (broadcasts
// via studio.focusParticipant; the overlay subscribes there in CP8 once
// we wire it; for now selection is implicit on hover/click in the canvas).

import { Component } from "../core/component";
import { Icons } from "../core/icons";
import { studio } from "../state/studio-store";
import { participantId as brand } from "../core/ids";
import type { Participant, Scene, SourcePlacement, SourceKind } from "../core/types";
import type { ParticipantId } from "../core/ids";
import { Popover, toast } from "./overlays";
import { createParticipantFromKind } from "../state/source-factory";
import { escapeHtml } from "./primitives";
import { userMessageFor } from "../core/errors";
import { centerPlacement, fitPlacement } from "../state/scene-composition";

interface State {
	scene: Scene;
	participants: Record<string, Participant>;
}

export class SourcesList extends Component<State> {
	private dragSourceId: string | null = null;

	constructor() {
		super({
			scene: studio.activeScene,
			participants: studio.state.participants,
		});
		studio.select(
			(s) => s.scenes.find((sc) => sc.id === s.activeSceneId),
			(scene) => { if (scene) this.setState({ scene }); },
		);
		studio.select(
			(s) => s.participants,
			(participants) => this.setState({ participants }),
		);
	}

	protected rootClass(): string {
		return "sources-list";
	}

	protected template(): string {
		// Render TOP of canvas = top of list, so reverse iterate the array.
		const rows = [...this.state.scene.sources].reverse();
		return `
			<div class="sources-list__head">
				<span class="section-header">Sources</span>
				<button class="sources-list__add" data-action="add" title="Add source" aria-label="Add source">${Icons.plus(12)}</button>
			</div>
			<div class="sources-list__items" data-items>
				${rows.length === 0
					? '<div class="sources-list__empty">No sources yet. Click <strong>+</strong> to add one.</div>'
					: rows.map((s) => this.renderRow(s)).join("")}
			</div>
		`;
	}

	private renderRow(placement: SourcePlacement): string {
		const p = this.state.participants[placement.participantId];
		if (!p) return "";
		const eye = placement.visible ? Icons.fullscreen(12) : Icons.fullscreen(12);
		const eyeClass = placement.visible ? "is-on" : "is-off";
		const kindGlyph = kindIcon(p.kind);
		return `
			<div class="source-row" data-pid="${escapeHtml(placement.participantId)}" draggable="true">
				<button class="source-row__select" data-action="focus" aria-label="Select ${escapeHtml(p.displayName)}">
					<span class="source-row__grip" aria-hidden="true">⋮</span>
					<span class="source-row__kind" aria-hidden="true">${kindGlyph}</span>
					<span class="source-row__name">${escapeHtml(p.displayName)}</span>
				</button>
				<button class="source-row__eye ${eyeClass}" data-action="toggle" aria-label="${placement.visible ? "Hide" : "Show"} ${escapeHtml(p.displayName)}">${eye}</button>
				<button class="source-row__menu" data-action="menu" aria-label="Source actions for ${escapeHtml(p.displayName)}">${Icons.more()}</button>
			</div>
		`;
	}

	protected afterMount(): void {
		this.el.setAttribute("role", "region");
		this.el.setAttribute("aria-label", "Sources in the active scene");
	}

	protected bind(): void {
		this.on(this.$('[data-action="add"]'), "click", (e) =>
			this.openAddMenu(e.currentTarget as HTMLElement),
		);
		for (const row of this.$$<HTMLElement>("[data-pid]")) {
			const raw = row.dataset["pid"];
			if (!raw) continue;
			const pid = brand(raw);
			const focus = row.querySelector<HTMLButtonElement>('[data-action="focus"]');
			if (focus) {
				this.on(focus, "click", () => {
					studio.focusParticipant(pid);
				});
			}
			const eye = row.querySelector<HTMLButtonElement>('[data-action="toggle"]');
			if (eye) {
				this.on(eye, "click", (e) => {
					e.stopPropagation();
					studio.toggleSourceVisibility(this.state.scene.id, pid);
				});
			}
			const menu = row.querySelector<HTMLButtonElement>('[data-action="menu"]');
			if (menu) {
				this.on(menu, "click", (e) => {
					e.stopPropagation();
					this.openRowMenu(pid, menu);
				});
			}
			// Drag to reorder. Drop on a target row swaps z-order positions.
			this.on(row, "dragstart", (e) => {
				const dt = (e as DragEvent).dataTransfer;
				if (!dt) return;
				dt.effectAllowed = "move";
				this.dragSourceId = raw;
				row.classList.add("is-dragging");
			});
			this.on(row, "dragend", () => {
				row.classList.remove("is-dragging");
				this.$$<HTMLElement>(".source-row").forEach((r) => r.classList.remove("is-drag-over"));
			});
			this.on(row, "dragover", (e) => {
				(e as DragEvent).preventDefault();
				row.classList.add("is-drag-over");
			});
			this.on(row, "dragleave", () => row.classList.remove("is-drag-over"));
			this.on(row, "drop", (e) => {
				(e as DragEvent).preventDefault();
				row.classList.remove("is-drag-over");
				if (!this.dragSourceId || this.dragSourceId === raw) return;
				studio.reorderSourceToTarget(this.state.scene.id, brand(this.dragSourceId), pid);
				this.dragSourceId = null;
			});
		}
	}

	private openRowMenu(pid: ParticipantId, anchor: HTMLElement): void {
		const menu = document.createElement("div");
		menu.className = "menu";
		menu.innerHTML = `
			<button class="menu__item" data-act="front">Bring to front</button>
			<button class="menu__item" data-act="back">Send to back</button>
			<button class="menu__item" data-act="center">Center on canvas</button>
			<button class="menu__item" data-act="fit">Fit to canvas</button>
			<div class="menu__divider"></div>
			<button class="menu__item menu__item--danger" data-act="remove">Remove from scene</button>
			<button class="menu__item menu__item--danger" data-act="delete">Delete participant</button>
		`;
		const popover = new Popover({ anchor, content: menu });
		menu.querySelectorAll<HTMLButtonElement>("[data-act]").forEach((btn) => {
			btn.addEventListener("click", () => {
				popover.dismiss();
				const sceneId = this.state.scene.id;
				switch (btn.dataset["act"]) {
					case "front":  studio.bringToFront(sceneId, pid); break;
					case "back":   studio.sendToBack(sceneId, pid); break;
					case "center": studio.updateSourcePlacement(sceneId, pid, centerPlacement()); break;
					case "fit":    studio.updateSourcePlacement(sceneId, pid, fitPlacement()); break;
					case "remove": studio.removeSource(sceneId, pid); break;
					case "delete": studio.removeParticipant(pid); break;
				}
			});
		});
	}

	private openAddMenu(anchor: HTMLElement): void {
		const menu = document.createElement("div");
		menu.className = "menu";
		menu.innerHTML = `
			<div class="menu__section">Local</div>
			<button class="menu__item" data-kind="camera">Webcam</button>
			<button class="menu__item" data-kind="screen">Screen capture</button>
			<button class="menu__item" data-kind="mic">Microphone</button>
			<div class="menu__section">AI co-host</div>
			<button class="menu__item" data-kind="voice">Voice only</button>
			<button class="menu__item" data-kind="voice-image">Voice + image</button>
			<button class="menu__item" data-kind="voice-vrm">Voice + VRM avatar…</button>
			<button class="menu__item" data-kind="voice-glb">Voice + GLB model…</button>
			<button class="menu__item" data-kind="text">Text assistant</button>
		`;
		const popover = new Popover({ anchor, content: menu });
		menu.querySelectorAll<HTMLButtonElement>("[data-kind]").forEach((btn) => {
			btn.addEventListener("click", () => {
				popover.dismiss();
				const kind = btn.dataset["kind"] as SourceKind;
				void createParticipantFromKind(kind).then((id) => {
					if (id) toast(`Added ${kind}`, "success");
				}).catch((err) => toast(`Add source failed: ${userMessageFor(err)}`, "error"));
			});
		});
	}
}

function kindIcon(kind: SourceKind): string {
	switch (kind) {
		case "camera": return Icons.camera(12);
		case "screen": return Icons.screen(12);
		case "mic": return Icons.mic(12);
		default: return Icons.notes(12);
	}
}
