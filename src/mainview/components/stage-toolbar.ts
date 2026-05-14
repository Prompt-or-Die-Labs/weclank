// Stage toolbar — sits above the program canvas. Two zones:
//   Left:  layout-snap presets (Single / Side-by-side / PIP / Triptych / Quad)
//          that compute SourcePlacement diffs for the visible sources in
//          the active scene and apply them in a batch.
//   Right: host dock (mic / camera / screen-share / + add source) — moved
//          here from the now-deleted stage-controls.ts so the host can
//          still toggle their own A/V without the bottom strip.
//
// Layout-snap math:
//   - Operates on the active scene's *visible* sources (everything in
//     scene.sources where visible:true).
//   - If there's nothing to arrange, the buttons no-op.
//   - PIP picks the first visible source as the background, second as the
//     inset. Subsequent visible sources are left where they are.

import { Component } from "../core/component";
import { Icons } from "../core/icons";
import { studio } from "../state/studio-store";
import type { Scene, SourcePlacement, SourceKind } from "../core/types";
import { participantId } from "../core/ids";
import type { ParticipantId } from "../core/ids";
import { IconButton } from "./primitives";
import { Popover, toast } from "./overlays";
import { createParticipantFromKind } from "../state/source-factory";
import { userMessageFor } from "../core/errors";
import { applyLayoutPreset, layoutPresetRects, type LayoutPreset, visibleSources } from "../state/scene-composition";
import { bunRpc } from "../rpc";

const HOST_ID = participantId("host");

const PRESET_DEFS: { id: LayoutPreset; label: string; glyph: () => string }[] = [
	{ id: "single",   label: "Single",        glyph: () => glyph(layoutPresetRects("single", 1)) },
	{ id: "split-2v", label: "Side-by-side",  glyph: () => glyph(layoutPresetRects("split-2v", 2)) },
	{ id: "split-2h", label: "Stack",         glyph: () => glyph(layoutPresetRects("split-2h", 2)) },
	{ id: "pip",      label: "PIP",           glyph: () => glyph(layoutPresetRects("pip", 2)) },
	{ id: "grid-3",   label: "Triptych",      glyph: () => glyph(layoutPresetRects("grid-3", 3)) },
	{ id: "grid-4",   label: "Quad",          glyph: () => glyph(layoutPresetRects("grid-4", 4)) },
];

function glyph(rects: Array<Pick<SourcePlacement, "x" | "y" | "w" | "h">>): string {
	const w = 22;
	const h = 14;
	const cells = rects
		.map((rect) => `<rect x="${(rect.x * w + 1).toFixed(1)}" y="${(rect.y * h + 1).toFixed(1)}" width="${(rect.w * w - 2).toFixed(1)}" height="${(rect.h * h - 2).toFixed(1)}" rx="1" fill="currentColor"/>`)
		.join("");
	return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block">${cells}</svg>`;
}

interface State {
	scene: Scene;
	hostMuted: boolean;
	hostCameraOff: boolean;
}

export class StageToolbar extends Component<State> {
	constructor() {
		const host = studio.state.participants[HOST_ID];
		super({
			scene: studio.activeScene,
			hostMuted: host?.muted ?? false,
			hostCameraOff: host?.cameraOff ?? true,
		});
		studio.select(
			(s) => s.scenes.find((sc) => sc.id === s.activeSceneId),
			(scene) => { if (scene) this.setState({ scene }); },
		);
		studio.select(
			(s) => s.participants[HOST_ID]?.muted,
			(muted) => this.setState({ hostMuted: muted ?? false }),
		);
		studio.select(
			(s) => s.participants[HOST_ID]?.cameraOff,
			(off) => this.setState({ hostCameraOff: off ?? true }),
		);
	}

	protected rootClass(): string {
		return "stage-toolbar";
	}

	protected template(): string {
		const visibleCount = visibleSources(this.state.scene).length;
		return `
			<div class="stage-toolbar__group" role="toolbar" aria-label="Layout presets">
				${PRESET_DEFS.map((p) => `
					<button class="stage-toolbar__preset" data-preset="${p.id}" title="${p.label}" aria-label="Apply ${p.label} layout" ${visibleCount < 1 ? "disabled" : ""}>
						${p.glyph()}
					</button>
				`).join("")}
			</div>
			<div class="stage-toolbar__group stage-toolbar__group--right" role="toolbar" aria-label="Host controls">
				${IconButton({
					icon: this.state.hostMuted ? Icons.micOff(14) : Icons.mic(14),
					variant: this.state.hostMuted ? "ghost" : "ghost",
					ariaLabel: this.state.hostMuted ? "Unmute host microphone" : "Mute host microphone",
					dataset: { action: "mic" },
				})}
				${IconButton({
					icon: this.state.hostCameraOff ? Icons.cameraOff(14) : Icons.camera(14),
					variant: this.state.hostCameraOff ? "ghost" : "ghost",
					ariaLabel: this.state.hostCameraOff ? "Turn on host camera" : "Turn off host camera",
					dataset: { action: "camera" },
				})}
				${IconButton({ icon: Icons.screen(14), variant: "ghost", ariaLabel: "Share screen", dataset: { action: "screen" } })}
				${IconButton({ icon: Icons.notes(14), variant: "ghost", ariaLabel: "Open teleprompter", dataset: { action: "prompter" } })}
				<span class="stage-toolbar__divider"></span>
				${IconButton({ icon: Icons.plus(14), variant: "ghost", ariaLabel: "Add source", dataset: { action: "add" } })}
			</div>
		`;
	}

	protected bind(): void {
		for (const btn of this.$$<HTMLButtonElement>("[data-preset]")) {
			const preset = btn.dataset["preset"] as LayoutPreset;
			this.on(btn, "click", () => this.applyPreset(preset));
		}
		for (const btn of this.$$<HTMLButtonElement>("[data-action]")) {
			this.on(btn, "click", (e) => this.onDock(btn.dataset["action"], e.currentTarget as HTMLElement));
		}
	}

	private applyPreset(preset: LayoutPreset): void {
		const scene = this.state.scene;
		for (const change of applyLayoutPreset(scene, preset)) {
			studio.updateSourcePlacement(scene.id, change.participantId as ParticipantId, change.placement);
		}
	}

	private onDock(action: string | undefined, anchor: HTMLElement): void {
		switch (action) {
			case "mic":
				studio.updateParticipant(HOST_ID, { muted: !studio.state.participants[HOST_ID]?.muted });
				break;
			case "camera":
				studio.updateParticipant(HOST_ID, { cameraOff: !studio.state.participants[HOST_ID]?.cameraOff });
				break;
			case "screen":
				void createParticipantFromKind("screen").then((id) => {
					if (id) toast("Screen capture added", "success");
				}).catch((err) => toast(`Screen capture failed: ${userMessageFor(err)}`, "error"));
				break;
			case "prompter":
				void bunRpc.openStudioUtilityWindow({ kind: "prompter", clickThrough: false, alwaysOnTop: true });
				break;
			case "add":
				this.openAddSourceMenu(anchor);
				break;
		}
	}

	private openAddSourceMenu(anchor: HTMLElement): void {
		const menu = document.createElement("div");
		menu.className = "menu";
		menu.innerHTML = `
			<div class="menu__section">Local</div>
			<button class="menu__item" data-kind="camera"><span class="menu__icon" aria-hidden="true">${Icons.camera(14)}</span><span>Webcam</span></button>
			<button class="menu__item" data-kind="screen"><span class="menu__icon" aria-hidden="true">${Icons.screen(14)}</span><span>Screen capture</span></button>
			<button class="menu__item" data-kind="mic"><span class="menu__icon" aria-hidden="true">${Icons.mic(14)}</span><span>Microphone</span><small>external agent</small></button>
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
