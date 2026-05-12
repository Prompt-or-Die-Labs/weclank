// Manual overlay control panel — list current overlays + form to add a
// new one. The agent's tool API does the same thing more dynamically, but
// this lets you preview a title card, pin a code snippet, etc., without
// waiting for the LLM to use the right tool.

import { Modal } from "../components/overlays";
import { streamOverlays } from "./stream-overlays";
import { OVERLAY_KINDS, OVERLAY_POSITIONS } from "../banter/tools";
import { escapeAttr, escapeHtml } from "../components/primitives";
import { mintId, overlayId } from "../core/ids";
import type { OverlayPosition, StreamOverlay, StreamOverlayKind } from "../core/types";

export function openOverlayManager(): void {
	const body = document.createElement("div");
	body.className = "tts-config overlay-manager";
	body.innerHTML = `
		<p class="device-picker__intro">Overlays render onto the broadcast canvas. Title cards stay put until removed; notices auto-dismiss.</p>

		<div class="overlay-manager__list" data-region="list"></div>

		<details class="overlay-manager__add">
			<summary>Add overlay</summary>
			<label class="tts-config__row">
				<span>Kind</span>
				<select data-field="kind">${OVERLAY_KINDS.map((k) => `<option value="${k}">${k}</option>`).join("")}</select>
			</label>
			<label class="tts-config__row">
				<span>Position</span>
				<select data-field="position">${OVERLAY_POSITIONS.map((p) => `<option value="${p}">${p}</option>`).join("")}</select>
			</label>
			<label class="tts-config__row">
				<span>Title</span>
				<input type="text" data-field="title" />
			</label>
			<label class="tts-config__row">
				<span>Subtitle</span>
				<input type="text" data-field="subtitle" />
			</label>
			<label class="tts-config__row">
				<span>Body (multi-line for code-snippet, message for notice)</span>
				<textarea data-field="body" rows="4"></textarea>
			</label>
			<label class="tts-config__row">
				<span>Auto-dismiss after (ms, blank = use kind default)</span>
				<input type="number" data-field="duration" min="500" step="500" placeholder="notice 6s · title-card 60s · code 90s · lower-third 120s" />
			</label>
			<label class="tts-config__row tts-config__row--inline">
				<input type="checkbox" data-field="sticky" />
				<span>Sticky — never auto-dismiss</span>
			</label>
			<div class="tts-config__actions">
				<button type="button" data-action="add" class="primary">Add overlay</button>
			</div>
		</details>

		<div class="tts-config__actions">
			<button type="button" data-action="close">Close</button>
		</div>
	`;

	const list = body.querySelector<HTMLElement>("[data-region=list]")!;

	const render = (): void => {
		const overlays = streamOverlays.all();
		if (overlays.length === 0) {
			list.innerHTML = `<div class="tts-config__hint">No overlays. Add one below.</div>`;
			return;
		}
		list.innerHTML = overlays
			.map((o) => `
				<div class="overlay-manager__item">
					<div class="overlay-manager__meta">
						<span class="overlay-manager__kind">${escapeHtml(o.kind)}</span>
						<span>${escapeHtml(o.props.title ?? o.props.body?.slice(0, 60) ?? o.id)}</span>
					</div>
					<button class="menu__item menu__item--danger" data-remove="${escapeAttr(o.id)}">Remove</button>
				</div>
			`).join("");
		list.querySelectorAll<HTMLButtonElement>("[data-remove]").forEach((btn) => {
			btn.addEventListener("click", () => {
				const raw = btn.dataset["remove"];
				if (raw) streamOverlays.remove(overlayId(raw));
				render();
			});
		});
	};
	render();

	const modal = new Modal({
		title: "Stream overlays",
		body,
		onClose: () => {},
	});
	body.querySelector<HTMLButtonElement>("[data-action=close]")!.addEventListener("click", () => modal.close());

	// Per-kind defaults — mirror the tool executor so manual + agent paths
	// produce the same "auto-dismisses after N seconds" behavior.
	const DEFAULTS: Record<StreamOverlayKind, number> = {
		"notice": 6_000,
		"title-card": 60_000,
		"code-snippet": 90_000,
		"lower-third": 120_000,
		"qr-code": 120_000,
	};

	body.querySelector<HTMLButtonElement>("[data-action=add]")!.addEventListener("click", () => {
		const kindSel = body.querySelector<HTMLSelectElement>("[data-field=kind]")!;
		const posSel = body.querySelector<HTMLSelectElement>("[data-field=position]")!;
		const titleEl = body.querySelector<HTMLInputElement>("[data-field=title]")!;
		const subEl = body.querySelector<HTMLInputElement>("[data-field=subtitle]")!;
		const bodyEl = body.querySelector<HTMLTextAreaElement>("[data-field=body]")!;
		const durEl = body.querySelector<HTMLInputElement>("[data-field=duration]")!;
		const stickyEl = body.querySelector<HTMLInputElement>("[data-field=sticky]")!;

		const now = Date.now();
		const kind = kindSel.value as StreamOverlayKind;
		const explicit = durEl.value.trim() ? Math.max(500, Number(durEl.value)) : undefined;
		const dur = stickyEl.checked ? undefined : explicit ?? DEFAULTS[kind];
		const overlay: StreamOverlay = {
			id: mintId("ov", overlayId),
			kind,
			props: {
				title: titleEl.value.trim() || undefined,
				subtitle: subEl.value.trim() || undefined,
				body: bodyEl.value || undefined,
			},
			position: posSel.value as OverlayPosition,
			createdAt: now,
			expiresAt: dur ? now + dur : undefined,
		};
		streamOverlays.add(overlay);
		titleEl.value = ""; subEl.value = ""; bodyEl.value = ""; durEl.value = "";
		stickyEl.checked = false;
		render();
	});
}
