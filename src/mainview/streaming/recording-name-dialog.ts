import { Modal } from "../components/overlays";
import { escapeHtml } from "../components/primitives";
import { recordingDateName, recordingFileName } from "../../shared/recording-names";

export function pickRecordingFileName(defaultStem = recordingDateName()): Promise<string | null> {
	return new Promise((resolve) => {
		let settled = false;
		const uid = `recording-name-${Date.now().toString(36)}`;
		const body = document.createElement("form");
		body.className = "recording-name";
		body.innerHTML = `
			<label class="recording-name__row" for="${uid}">
				<span>File name</span>
				<input id="${uid}" name="recordingName" type="text" autocomplete="off" spellcheck="false" value="${escapeHtml(defaultStem)}" />
			</label>
			<div class="recording-name__actions">
				<button type="button" class="secondary" data-action="cancel">Cancel</button>
				<button type="submit" class="primary">Start recording</button>
			</div>
		`;
		const finish = (value: string | null): void => {
			if (settled) return;
			settled = true;
			resolve(value);
		};
		const modal = new Modal({
			title: "Save recording",
			body,
			initialFocusSelector: `#${uid}`,
			onClose: () => finish(null),
		});
		const input = body.querySelector<HTMLInputElement>(`#${uid}`)!;
		body.addEventListener("submit", (event) => {
			event.preventDefault();
			finish(recordingFileName(input.value, defaultStem));
			modal.close();
		});
		body.querySelector<HTMLButtonElement>('[data-action="cancel"]')?.addEventListener("click", () => {
			finish(null);
			modal.close();
		});
		setTimeout(() => input.select(), 0);
	});
}
