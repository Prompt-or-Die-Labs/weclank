// Scenes accordion section — the scene list with thumbnails, drag-reorder,
// rename/duplicate/delete menu, and add-scene "+". Owns its own collapse
// state; ScenePanel mounts it as one of four peer sections without ever
// destroying it.

import { Component } from "../core/component";
import { Icons } from "../core/icons";
import { studio } from "../state/studio-store";
import { sceneId } from "../core/ids";
import type { SceneId } from "../core/ids";
import type { Scene } from "../core/types";
import { Popover, toast } from "./overlays";
import { escapeHtml } from "./primitives";

const COLLAPSED_KEY = "studio.scenePanel.scenesCollapsed";

interface State {
	scenes: Scene[];
	activeSceneId: SceneId;
	collapsed: boolean;
}

function readCollapsed(): boolean {
	try { return localStorage.getItem(COLLAPSED_KEY) === "1"; } catch { return false; }
}
function writeCollapsed(value: boolean): void {
	try { localStorage.setItem(COLLAPSED_KEY, value ? "1" : "0"); } catch { /* unavailable */ }
}

export class ScenesSection extends Component<State> {
	constructor() {
		super({
			scenes: studio.state.scenes,
			activeSceneId: studio.state.activeSceneId,
			collapsed: readCollapsed(),
		});
		studio.select((s) => s.scenes, (scenes) => this.setState({ scenes }));
		studio.select((s) => s.activeSceneId, (activeSceneId) => this.setState({ activeSceneId }));
	}

	protected rootClass(): string {
		return "scene-panel__section scene-panel__section--scenes";
	}

	protected update(): void {
		this.el.classList.toggle("is-collapsed", this.state.collapsed);
		super.update();
	}

	protected afterMount(): void {
		this.el.classList.toggle("is-collapsed", this.state.collapsed);
		this.el.setAttribute("aria-label", "Scenes");
	}

	protected template(): string {
		const { collapsed, scenes } = this.state;
		return `
			<div class="scene-panel__head">
				<button class="scene-panel__head-toggle" data-toggle type="button" aria-expanded="${collapsed ? "false" : "true"}" aria-controls="scenes-body">
					<span class="scene-panel__chevron" aria-hidden="true">${Icons.chevronDown(12)}</span>
					<span class="section-header">Scenes</span>
				</button>
				<button class="scene-panel__add" data-add type="button" title="Add scene" aria-label="Add scene">${Icons.plus(12)}</button>
			</div>
			<div class="scene-list" id="scenes-body" role="list" aria-label="Scene list"${collapsed ? ' hidden=""' : ""}>
				${scenes.map((s) => this.renderItem(s)).join("")}
			</div>
		`;
	}

	private renderItem(scene: Scene): string {
		const active = scene.id === this.state.activeSceneId;
		const visible = scene.sources.filter((s) => s.visible).length;
		return `
			<div class="scene-item${active ? " scene-item--active" : ""}" data-scene-id="${scene.id}" draggable="true" role="listitem">
				<div class="scene-item__head">
					<span class="scene-item__name">${escapeHtml(scene.name)}</span>
					<button class="scene-item__menu" aria-label="Scene options for ${escapeHtml(scene.name)}" data-action="menu">${Icons.more()}</button>
				</div>
				<button class="scene-item__thumb" data-action="activate" aria-label="Activate ${escapeHtml(scene.name)}" aria-current="${active ? "true" : "false"}">
					${this.renderThumb(scene)}
					${visible > 0 ? `<span class="scene-item__participants">${Icons.user(12)} ${visible}</span>` : ""}
				</button>
			</div>
		`;
	}

	private renderThumb(scene: Scene): string {
		const W = 110;
		const H = 60;
		const rects = scene.sources.filter((s) => s.visible).map((s) => ({
			x: Math.round(s.x * W),
			y: Math.round(s.y * H),
			w: Math.max(2, Math.round(s.w * W)),
			h: Math.max(2, Math.round(s.h * H)),
		}));
		return `
			<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
				<rect width="${W}" height="${H}" fill="#111"/>
				${rects.map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="3" fill="#2a2a2a"/>`).join("")}
			</svg>
		`;
	}

	protected bind(): void {
		this.on(this.$("[data-toggle]"), "click", () => this.toggle());
		this.on(this.$("[data-add]"), "click", (e) => {
			e.stopPropagation();
			if (this.state.collapsed) this.toggle();
			const created = studio.addScene(`Scene ${studio.state.scenes.length + 1}`);
			studio.activateScene(created.id);
		});

		let dragSourceId: string | null = null;
		for (const item of this.$$<HTMLElement>(".scene-item")) {
			const raw = item.dataset["sceneId"];
			if (!raw) continue;
			const id = sceneId(raw);
			this.on(item.querySelector('[data-action="activate"]')!, "click", () => studio.activateScene(id));
			this.on(item.querySelector('[data-action="menu"]')!, "click", (e) => {
				e.stopPropagation();
				this.openSceneMenu(id, e.currentTarget as HTMLElement);
			});
			this.on(item, "dragstart", (e) => {
				dragSourceId = raw;
				(e as DragEvent).dataTransfer?.setData("text/plain", raw);
				item.classList.add("is-dragging");
			});
			this.on(item, "dragend", () => {
				item.classList.remove("is-dragging");
				this.$$<HTMLElement>(".scene-item").forEach((i) => i.classList.remove("is-drag-over"));
			});
			this.on(item, "dragover", (e) => {
				(e as DragEvent).preventDefault();
				item.classList.add("is-drag-over");
			});
			this.on(item, "dragleave", () => item.classList.remove("is-drag-over"));
			this.on(item, "drop", (e) => {
				(e as DragEvent).preventDefault();
				item.classList.remove("is-drag-over");
				if (!dragSourceId || dragSourceId === raw) return;
				studio.reorderScenes(sceneId(dragSourceId), id);
				dragSourceId = null;
			});
		}
	}

	private toggle(): void {
		const next = !this.state.collapsed;
		writeCollapsed(next);
		this.setState({ collapsed: next });
	}

	private openSceneMenu(id: SceneId, anchor: HTMLElement): void {
		const menu = document.createElement("div");
		menu.className = "menu";
		menu.innerHTML = `
			<button class="menu__item" data-act="rename"><span class="menu__icon" aria-hidden="true">${Icons.edit(14)}</span><span>Rename…</span></button>
			<button class="menu__item" data-act="duplicate"><span class="menu__icon" aria-hidden="true">${Icons.copy(14)}</span><span>Duplicate</span></button>
			<button class="menu__item menu__item--danger" data-act="delete"><span class="menu__icon" aria-hidden="true">${Icons.trash(14)}</span><span>Delete</span></button>
		`;
		const popover = new Popover({ anchor, content: menu });
		menu.querySelectorAll<HTMLButtonElement>("[data-act]").forEach((btn) => {
			btn.addEventListener("click", () => {
				popover.dismiss();
				switch (btn.dataset["act"]) {
					case "rename": {
						const scene = studio.state.scenes.find((s) => s.id === id);
						const next = window.prompt("Rename scene", scene?.name ?? "");
						if (next && next.trim()) studio.renameScene(id, next.trim());
						break;
					}
					case "duplicate":
						studio.duplicateScene(id);
						break;
					case "delete":
						if (studio.state.scenes.length <= 1) {
							toast("Can't delete the last scene", "error");
							return;
						}
						studio.deleteScene(id);
						break;
				}
			});
		});
	}
}
