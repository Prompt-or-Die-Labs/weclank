// Keyboard shortcuts + a "where do my files live?" reference + a link to
// the repo. No interactivity beyond closing.

import { Modal } from "./overlays";
import { bunRpc } from "../rpc";

export async function openHelpDialog(): Promise<void> {
	const body = document.createElement("div");
	body.className = "help-dialog";
	body.innerHTML = `
		<section class="help-dialog__section">
			<h3>Keyboard shortcuts</h3>
			<dl>
				<dt><kbd>⌘ 1</kbd> .. <kbd>⌘ 9</kbd></dt><dd>Switch to scene N</dd>
				<dt><kbd>⌘ ⇧ L</kbd></dt><dd>Go Live / stop streaming</dd>
				<dt><kbd>⌘ ⇧ R</kbd></dt><dd>Start / stop local recording</dd>
				<dt><kbd>[</kbd> <kbd>]</kbd></dt><dd>Cycle the right-sidebar tab</dd>
				<dt><kbd>↑↓←→</kbd></dt><dd>Nudge the selected source (Shift = 10×)</dd>
				<dt><kbd>Esc</kbd></dt><dd>Deselect source</dd>
			</dl>
		</section>
		<section class="help-dialog__section">
			<h3>Where things live</h3>
			<dl>
				<dt>Database</dt><dd data-field="dbPath">…</dd>
				<dt>API keys</dt><dd>Encrypted in the SQLite file's <code>user_secrets</code> table.</dd>
				<dt>Account password</dt><dd>argon2id hash in <code>users.password_hash</code>. Forgot it? Delete the file and sign up again — local-only auth has no reset.</dd>
			</dl>
		</section>
		<section class="help-dialog__section">
			<h3>Open source</h3>
			<p>Weclank is open source. The SQLite file is portable: back it up to keep your scenes / agents across machines.</p>
		</section>
		<div class="tts-config__actions">
			<button type="button" data-action="close" class="primary">Close</button>
		</div>
	`;

	const modal = new Modal({ title: "Help", body, onClose: () => {} });
	body.querySelector<HTMLButtonElement>("[data-action=close]")!.addEventListener("click", () => modal.close());

	const dbPathEl = body.querySelector<HTMLElement>("[data-field=dbPath]");
	if (dbPathEl) {
		try {
			const { path } = await bunRpc.getDatabasePath({});
			dbPathEl.textContent = path;
		} catch {
			dbPathEl.textContent = "(unavailable)";
		}
	}
}
