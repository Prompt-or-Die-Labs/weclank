import { bunRpc } from "../rpc";

let installed = false;

export function installNativeContextMenu(): void {
	if (installed) return;
	installed = true;
	document.addEventListener("contextmenu", (event) => {
		const target = event.target;
		if (!(target instanceof Element)) return;
		event.preventDefault();
		void bunRpc.showNativeContextMenu({
			editable: isEditableTarget(target),
			hasSelection: Boolean(window.getSelection()?.toString().trim()),
		});
	});
}

function isEditableTarget(target: Element): boolean {
	if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
		return true;
	}
	return target instanceof HTMLElement && target.isContentEditable;
}
