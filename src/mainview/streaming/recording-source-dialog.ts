import type { SourceKind } from "../core/types";
import { Icons } from "../core/icons";
import { Modal } from "../components/overlays";

export type RecordingSourceKind = Extract<SourceKind, "screen" | "camera">;

export function pickRecordingSourceKind(): Promise<RecordingSourceKind | null> {
	return pickRecordingSource(async (kind) => kind);
}

export function pickRecordingSource<T>(
	createSource: (kind: RecordingSourceKind) => Promise<T | null>,
): Promise<T | null> {
	return new Promise((resolve, reject) => {
		let settled = false;
		const body = document.createElement("div");
		body.className = "recording-source";
		body.innerHTML = `
			<p>Choose a source for this recording.</p>
			<div class="recording-source__actions">
				<button type="button" class="primary" data-kind="screen">${Icons.screen(14)}<span>Screen capture</span></button>
				<button type="button" data-kind="camera">${Icons.camera(14)}<span>Webcam / iPhone</span></button>
				<button type="button" data-action="cancel">Cancel</button>
			</div>
		`;
		const cancel = (): void => {
			if (settled) return;
			settled = true;
			resolve(null);
			modal.close();
		};
		const pick = (kind: RecordingSourceKind): void => {
			if (settled) return;
			settled = true;
			createSource(kind)
				.then(resolve, reject)
				.finally(() => modal.close());
		};
		const modal = new Modal({
			title: "Record what?",
			body,
			initialFocusSelector: "[data-kind=screen]",
			onClose: cancel,
		});
		body.querySelectorAll<HTMLButtonElement>("[data-kind]").forEach((btn) => {
			btn.addEventListener("click", () => pick(btn.dataset["kind"] as RecordingSourceKind));
		});
		body.querySelector<HTMLButtonElement>("[data-action=cancel]")?.addEventListener("click", cancel);
	});
}
