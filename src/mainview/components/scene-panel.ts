// Left rail: scene list on top, sources sublist below. Each scene item
// shows a tiny SVG thumbnail mirroring its source placements.

import { Component } from "../core/component";
import { Icons } from "../core/icons";
import { studio } from "../state/studio-store";
import { sceneId } from "../core/ids";
import type { SceneId } from "../core/ids";
import type { Scene } from "../core/types";
import { Popover, toast } from "./overlays";
import { escapeHtml } from "./primitives";
import { SourcesList } from "./sources-list";

interface State {
	scenes: Scene[];
	activeSceneId: SceneId;
}

export class ScenePanel extends Component<State> {
	constructor() {
		super({ scenes: studio.state.scenes, activeSceneId: studio.state.activeSceneId });
		// Selective subscriptions — only re-render when the slices we
		// actually care about change. Otherwise unrelated state churn
		// (mute toggles, audio streams) would tear down the whole list.
		studio.select((s) => s.scenes, (scenes) => this.setState({ scenes }));
		studio.select((s) => s.activeSceneId, (activeSceneId) => this.setState({ activeSceneId }));
	}

	protected rootClass(): string {
		return "scene-panel";
	}

	protected template(): string {
		return `
			<nav class="scene-panel__section scene-panel__section--scenes" aria-label="Scenes">
				<div class="scene-panel__head">
					<span class="section-header" id="scene-panel-heading">Scenes</span>
					<button class="scene-panel__add" id="add-scene" title="Add scene" aria-label="Add scene">${Icons.plus(12)}</button>
				</div>
				<div class="scene-list" role="list" aria-labelledby="scene-panel-heading">
					${this.state.scenes.map((scene) => this.renderItem(scene)).join("")}
				</div>
			</nav>
			<div class="scene-panel__section scene-panel__section--sources" data-sources-mount></div>
		`;
	}

	private sourcesList: SourcesList | null = null;

	protected afterMount(): void {
		this.mountSources();
	}

	protected update(): void {
		super.update();
		this.mountSources();
	}

	protected beforeDestroy(): void {
		this.sourcesList?.destroy();
		this.sourcesList = null;
	}

	private mountSources(): void {
		const host = this.$<HTMLElement>("[data-sources-mount]");
		if (!host) return;
		this.sourcesList?.destroy();
		this.sourcesList = new SourcesList();
		this.sourcesList.mount(host);
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
		// Tiny mirror of the scene's source layout. Iterate sources by
		// their 0..1 ratios — same shape as the broadcast canvas, just
		// shrunk to a swatch.
		const W = 110;
		const H = 60;
		const rects = scene.sources
			.filter((s) => s.visible)
			.map((s) => ({
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
		this.on(this.$("#add-scene"), "click", () => {
			const scene = studio.addScene(`Scene ${studio.state.scenes.length + 1}`);
			studio.activateScene(scene.id);
		});
		let dragSourceId: string | null = null;
		for (const item of this.$$<HTMLElement>(".scene-item")) {
			const raw = item.dataset["sceneId"];
			if (!raw) continue;
			const id = sceneId(raw);
			this.on(item.querySelector('[data-action="activate"]')!, "click", () =>
				studio.activateScene(id),
			);
			this.on(item.querySelector('[data-action="menu"]')!, "click", (e) => {
				e.stopPropagation();
				this.openSceneMenu(id, e.currentTarget as HTMLElement);
			});

			// Drag-reorder: dragstart marks the source; dragover lets the
			// drop fire; drop rearranges and re-renders.
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

	private openSceneMenu(id: SceneId, anchor: HTMLElement): void {
		const menu = document.createElement("div");
		menu.className = "menu";
		menu.innerHTML = `
			<button class="menu__item" data-act="rename">Rename…</button>
			<button class="menu__item" data-act="duplicate">Duplicate</button>
			<button class="menu__item menu__item--danger" data-act="delete">Delete</button>
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
