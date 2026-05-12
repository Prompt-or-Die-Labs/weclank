// Backstage strip — bottom strip under the canvas showing participants that
// are NOT currently on stage (either not in the active scene's source list,
// or in it but with visible:false). Click promotes a backstage participant
// onto the active scene at a default placement.
//
// Semantics: keep-warm. Off-stage doesn't tear down MediaStream or TTS —
// it just suppresses canvas drawing. Promotion is instant; no warmup.
//
// Empty state: "Drop a source here from the canvas to bring it backstage"
// (CP7's source list will wire drag-from-canvas to here).

import { Component } from "../core/component";
import { studio } from "../state/studio-store";
import type { Participant, Scene } from "../core/types";
import { Icons } from "../core/icons";
import { escapeHtml } from "./primitives";
import { backstageEntries, type BackstageEntry } from "../state/scene-composition";

interface State {
	scene: Scene;
	participants: Record<string, Participant>;
}

export class BackstageStrip extends Component<State> {
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
		return "backstage-strip";
	}

	protected template(): string {
		const entries = this.computeBackstage();
		if (entries.length === 0) {
			return `
				<div class="backstage-strip__label">Backstage</div>
				<div class="backstage-strip__empty">All sources are on stage.</div>
			`;
		}
		return `
			<div class="backstage-strip__label">Backstage · ${entries.length}</div>
			<div class="backstage-strip__list">
				${entries.map((e) => this.renderTile(e)).join("")}
			</div>
		`;
	}

	private computeBackstage(): BackstageEntry[] {
		return backstageEntries(this.state.scene, this.state.participants);
	}

	private renderTile(entry: BackstageEntry): string {
		const p = entry.participant;
		const initial = (p.displayName || p.kind).charAt(0).toUpperCase();
		const kindGlyph = kindIcon(p);
		return `
			<button class="backstage-tile" data-pid="${escapeHtml(p.id)}" title="Add to active scene · ${escapeHtml(p.displayName)}">
				<div class="backstage-tile__thumb">
					<span class="backstage-tile__initial">${escapeHtml(initial)}</span>
					${kindGlyph ? `<span class="backstage-tile__kind">${kindGlyph}</span>` : ""}
				</div>
				<span class="backstage-tile__name">${escapeHtml(p.displayName)}</span>
				${entry.hiddenInScene ? '<span class="backstage-tile__badge">hidden</span>' : ""}
			</button>
		`;
	}

	protected bind(): void {
		for (const btn of this.$$<HTMLButtonElement>("[data-pid]")) {
			const id = btn.dataset["pid"];
			if (!id) continue;
			this.on(btn, "click", () => this.promote(id));
		}
	}

	private promote(pid: string): void {
		const branded = pid as Parameters<typeof studio.addSource>[1];
		const scene = this.state.scene;
		const existing = scene.sources.find((s) => s.participantId === branded);
		if (existing) {
			// Already in the scene's source list, just flip visibility on.
			studio.updateSourcePlacement(scene.id, branded, { visible: true });
		} else {
			studio.addSource(scene.id, branded);
		}
	}
}

function kindIcon(p: Participant): string {
	switch (p.kind) {
		case "camera":
			return Icons.camera(10);
		case "screen":
			return Icons.screen(10);
		case "mic":
			return Icons.mic(10);
		default:
			return p.isAgent ? Icons.notes(10) : "";
	}
}
