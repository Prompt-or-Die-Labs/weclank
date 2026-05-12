// QR Codes dialog — type text or a URL, preview it, optionally drop it
// onto the stream as an overlay.

import QRCode from "qrcode";
import { Modal, toast } from "./overlays";
import { addQrOverlay } from "../streaming/qr-overlay";
import { userMessageFor } from "../core/errors";
import type { OverlayPosition } from "../core/types";

const POSITIONS: OverlayPosition[] = ["bottom-right", "bottom-left", "top-right", "top-left", "center"];

export function openQrDialog(): void {
	const body = document.createElement("div");
	body.className = "tts-config qr-dialog";
	body.innerHTML = `
		<p class="device-picker__intro">Render a QR code on the broadcast — useful for join links, GitHub repos, or BTC tip jars.</p>
		<label class="tts-config__row">
			<span>Text or URL</span>
			<input type="text" data-field="text" placeholder="https://github.com/you/repo" />
		</label>
		<label class="tts-config__row">
			<span>Label</span>
			<input type="text" data-field="label" placeholder="Scan to join" />
		</label>
		<label class="tts-config__row">
			<span>Position</span>
			<select data-field="position">${POSITIONS.map((p) => `<option value="${p}">${p}</option>`).join("")}</select>
		</label>
		<label class="tts-config__row">
			<span>Auto-dismiss after (ms, blank = sticky)</span>
			<input type="number" data-field="duration" min="500" step="500" placeholder="60000" />
		</label>
		<div class="qr-dialog__preview" data-region="preview"></div>
		<div class="tts-config__actions">
			<button type="button" data-action="cancel">Cancel</button>
			<button type="button" data-action="add" class="primary">Add to stream</button>
		</div>
	`;

	const text = body.querySelector<HTMLInputElement>("[data-field=text]")!;
	const label = body.querySelector<HTMLInputElement>("[data-field=label]")!;
	const position = body.querySelector<HTMLSelectElement>("[data-field=position]")!;
	const duration = body.querySelector<HTMLInputElement>("[data-field=duration]")!;
	const preview = body.querySelector<HTMLElement>("[data-region=preview]")!;

	let previewTimer: ReturnType<typeof setTimeout> | null = null;
	const updatePreview = (): void => {
		if (previewTimer) clearTimeout(previewTimer);
		previewTimer = setTimeout(async () => {
			if (!text.value.trim()) {
				preview.innerHTML = "";
				return;
			}
			try {
				const dataUrl = await QRCode.toDataURL(text.value, { width: 200, margin: 1 });
				preview.innerHTML = `<img src="${dataUrl}" alt="QR preview" />`;
			} catch {
				preview.innerHTML = `<small>Couldn't render preview.</small>`;
			}
		}, 200);
	};
	text.addEventListener("input", updatePreview);

	const modal = new Modal({ title: "QR Code", body, onClose: () => {} });
	body.querySelector<HTMLButtonElement>("[data-action=cancel]")!.addEventListener("click", () => modal.close());
	body.querySelector<HTMLButtonElement>("[data-action=add]")!.addEventListener("click", async () => {
		const t = text.value.trim();
		if (!t) { text.focus(); return; }
		const dur = duration.value.trim() ? Math.max(500, Number(duration.value)) : undefined;
		try {
			await addQrOverlay({
				text: t,
				label: label.value.trim() || undefined,
				position: position.value as OverlayPosition,
				durationMs: dur,
			});
			toast("QR added to stream", "success");
			modal.close();
		} catch (err) {
			toast(`QR failed: ${userMessageFor(err)}`, "error");
		}
	});
}
