// Paste JSON → validate → append scenes (new ids, filtered sources).

import { Modal, toast } from "./overlays";
import { escapeHtml } from "./primitives";
import { studio } from "../state/studio-store";
import { parseScenePackJson, SCENE_PACK_EXAMPLE } from "../state/scene-import";
import { userMessageFor } from "../core/errors";

export function openSceneImportDialog(): void {
	const body = document.createElement("div");
	body.className = "scene-import-dialog";
	body.innerHTML = `
		<p class="scene-import-dialog__lead">
			Paste a <strong>weclankScenePack</strong> or the <code>scenes</code> section from a full program export.
			Only sources whose <code>participantId</code> exists in this session are kept. Each imported scene gets a new id.
		</p>
		<label class="scene-import-dialog__label" for="scene-import-json">JSON</label>
		<textarea id="scene-import-json" class="scene-import-dialog__textarea" rows="12" spellcheck="false" aria-describedby="scene-import-hint"></textarea>
		<p id="scene-import-hint" class="scene-import-dialog__hint">Example shape:</p>
		<pre class="scene-import-dialog__sample" tabindex="-1">${escapeHtml(SCENE_PACK_EXAMPLE)}</pre>
		<div class="scene-import-dialog__status" data-region="status" role="status" aria-live="polite"></div>
		<div class="scene-import-dialog__actions">
			<button type="button" class="secondary" data-act="parse">Validate</button>
			<button type="button" class="primary" data-act="apply" disabled>Import scenes</button>
		</div>
	`;

	const modal = new Modal({
		title: "Import scenes",
		body,
		initialFocusSelector: "#scene-import-json",
		onClose: () => {},
	});
	const ta = body.querySelector<HTMLTextAreaElement>("#scene-import-json")!;
	const status = body.querySelector<HTMLElement>("[data-region=status]")!;
	const applyBtn = body.querySelector<HTMLButtonElement>("[data-act=apply]")!;

	let pending: ReturnType<typeof parseScenePackJson> | null = null;

	const known = (): Set<string> => new Set(Object.keys(studio.state.participants));

	const setStatus = (html: string): void => {
		status.innerHTML = html;
	};

	body.querySelector<HTMLButtonElement>("[data-act=parse]")!.addEventListener("click", () => {
		pending = null;
		applyBtn.disabled = true;
		const raw = ta.value.trim();
		if (!raw) {
			setStatus('<span class="scene-import-dialog__err">Paste JSON first.</span>');
			return;
		}
		const r = parseScenePackJson(raw, known());
		if (!r.ok) {
			setStatus(`<span class="scene-import-dialog__err">${escapeHtml(r.error)}</span>`);
			return;
		}
		pending = r;
		const w = r.result.warnings.length
			? `<ul class="scene-import-dialog__warns">${r.result.warnings.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`
			: "";
		setStatus(
			`<span class="scene-import-dialog__ok">OK — ${r.result.scenes.length} scene(s) ready to import.</span>${w}`,
		);
		applyBtn.disabled = false;
	});

	applyBtn.addEventListener("click", () => {
		if (!pending || !pending.ok) return;
		try {
			studio.appendImportedScenes(pending.result.scenes);
			const n = pending.result.warnings.length;
			toast(`Imported ${pending.result.scenes.length} scene(s)${n ? ` (${n} warning(s))` : ""}.`, "success");
			modal.close();
		} catch (e) {
			toast(userMessageFor(e), "error");
		}
	});
}
