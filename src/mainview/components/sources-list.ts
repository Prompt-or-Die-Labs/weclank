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
	collapsed: boolean;
}

const SOURCES_COLLAPSED_KEY = "studio.sourcesList.collapsed";

function readSourcesCollapsed(): boolean {
	try {
		return localStorage.getItem(SOURCES_COLLAPSED_KEY) === "1";
	} catch {
		return false;
	}
}

function writeSourcesCollapsed(value: boolean): void {
	try {
		localStorage.setItem(SOURCES_COLLAPSED_KEY, value ? "1" : "0");
	} catch { /* unavailable */ }
}

export class SourcesList extends Component<State> {
	private dragSourceId: string | null = null;

	constructor() {
		super({
			scene: studio.activeScene,
			participants: studio.state.participants,
			collapsed: readSourcesCollapsed(),
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
		return "scene-panel__section scene-panel__section--sources sources-list";
	}

	protected update(): void {
		this.el.classList.toggle("is-collapsed", this.state.collapsed);
		this.el.classList.toggle("sources-list--collapsed", this.state.collapsed);
		super.update();
	}

	protected afterMount(): void {
		this.el.classList.toggle("is-collapsed", this.state.collapsed);
		this.el.classList.toggle("sources-list--collapsed", this.state.collapsed);
		this.el.setAttribute("role", "region");
		this.el.setAttribute("aria-label", "Sources in the active scene");
	}

	protected template(): string {
		// Render TOP of canvas = top of list, so reverse iterate the array.
		const rows = [...this.state.scene.sources].reverse();
		const collapsed = this.state.collapsed;
		return `
			<div class="scene-panel__head sources-list__head">
				<button class="scene-panel__head-toggle sources-list__head-toggle" data-sources-toggle type="button" aria-expanded="${collapsed ? "false" : "true"}" aria-controls="sources-list-body">
					<span class="scene-panel__chevron sources-list__chevron" aria-hidden="true">${Icons.chevronDown(12)}</span>
					<span class="section-header">Sources</span>
				</button>
				<button class="scene-panel__add sources-list__add" data-sources-add type="button" title="Add source" aria-label="Add source">${Icons.plus(12)}</button>
			</div>
			<div class="sources-list__items" id="sources-list-body" data-items${collapsed ? ' hidden=""' : ""}>
				${rows.length === 0
					? '<div class="sources-list__empty">No sources yet. Click <strong>+</strong> to add one.</div>'
					: rows.map((s) => this.renderRow(s)).join("")}
			</div>
		`;
	}

	private renderRow(placement: SourcePlacement): string {
		const p = this.state.participants[placement.participantId];
		if (!p) return "";
		const eye = placement.visible ? Icons.eye(12) : Icons.eyeOff(12);
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

	protected bind(): void {
		this.on(this.$("[data-sources-toggle]"), "click", () => {
			const next = !this.state.collapsed;
			writeSourcesCollapsed(next);
			this.setState({ collapsed: next });
		});
		this.on(this.$("[data-sources-add]"), "click", (e) => {
			e.stopPropagation();
			if (this.state.collapsed) {
				writeSourcesCollapsed(false);
				this.setState({ collapsed: false });
			}
			this.openAddMenu(e.currentTarget as HTMLElement);
		});
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
			<button class="menu__item" data-act="front"><span class="menu__icon" aria-hidden="true">${Icons.expand(14)}</span><span>Bring to front</span></button>
			<button class="menu__item" data-act="back"><span class="menu__icon" aria-hidden="true">${Icons.minimize(14)}</span><span>Send to back</span></button>
			<button class="menu__item" data-act="center"><span class="menu__icon" aria-hidden="true">${Icons.layoutSwap(14)}</span><span>Center on canvas</span></button>
			<button class="menu__item" data-act="fit"><span class="menu__icon" aria-hidden="true">${Icons.fullscreen(14)}</span><span>Fit to canvas</span></button>
			<div class="menu__divider"></div>
			<button class="menu__item menu__item--danger" data-act="remove"><span class="menu__icon" aria-hidden="true">${Icons.trash(14)}</span><span>Remove from scene</span></button>
			<button class="menu__item menu__item--danger" data-act="delete"><span class="menu__icon" aria-hidden="true">${Icons.trash(14)}</span><span>Delete participant</span></button>
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
			<button class="menu__item" data-kind="camera"><span class="menu__icon" aria-hidden="true">${Icons.camera(14)}</span><span>Webcam</span></button>
			<button class="menu__item" data-kind="screen"><span class="menu__icon" aria-hidden="true">${Icons.screen(14)}</span><span>Screen capture</span></button>
			<button class="menu__item" data-kind="mic"><span class="menu__icon" aria-hidden="true">${Icons.mic(14)}</span><span>Microphone</span></button>
			<div class="menu__section">AI co-host</div>
			<button class="menu__item" data-kind="voice"><span class="menu__icon" aria-hidden="true">${Icons.bot(14)}</span><span>Voice only</span></button>
			<button class="menu__item" data-kind="voice-image"><span class="menu__icon" aria-hidden="true">${Icons.image(14)}</span><span>Voice + image</span></button>
			<button class="menu__item" data-kind="voice-vrm"><span class="menu__icon" aria-hidden="true">${Icons.user(14)}</span><span>Voice + VRM avatar…</span></button>
			<button class="menu__item" data-kind="voice-glb"><span class="menu__icon" aria-hidden="true">${Icons.layoutSwap(14)}</span><span>Voice + GLB model…</span></button>
			<button class="menu__item" data-kind="text"><span class="menu__icon" aria-hidden="true">${Icons.notes(14)}</span><span>Text assistant</span></button>
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
