// Eliza Cloud API key — pasted by the user after a browser-assisted
// dashboard visit. As of 2026-05, ElizaOS's docs describe `elizaos login`
// as "opens browser for auth, your API key is saved automatically" — i.e.
// the public flow is browser-dashboard + key copy/paste, not a documented
// OAuth/PKCE handshake. If/when Eliza Cloud publishes an OAuth spec we can
// upgrade this to mirror the OpenRouter pattern.
//
// Keys follow the `eliza_` prefix convention per ElizaOS docs.

import { Modal, toast } from "../components/overlays";
import { setSecretAndPersist, hasSecret, deleteSecretAndPersist } from "./secrets-cache";
import { bunRpc } from "../rpc";
import { userMessageFor } from "../core/errors";

export const ELIZACLOUD_API_KEY = "elizacloud";
const DASHBOARD_URL = "https://www.elizacloud.ai/dashboard/api-keys";

export function isElizaCloudConnected(): boolean {
	return hasSecret(ELIZACLOUD_API_KEY);
}

export async function disconnectElizaCloud(): Promise<void> {
	await deleteSecretAndPersist(ELIZACLOUD_API_KEY);
}

export async function openElizaCloudApiKeyDialog(): Promise<void> {
	return new Promise((resolve) => {
		const body = document.createElement("div");
		body.className = "tts-config";
		body.innerHTML = `
			<p class="device-picker__intro">Eliza Cloud is ElizaOS's hosted AI platform — chat, image, audio, and video models exposed through one API. Generate a key from your dashboard, then paste it here.</p>
			<div class="tts-config__actions">
				<button type="button" data-action="open">Open Eliza Cloud dashboard</button>
			</div>
			<label class="tts-config__row">
				<span>API key</span>
				<input type="password" data-field="key" autocomplete="off" spellcheck="false" placeholder="eliza_…" />
			</label>
			<p class="tts-config__hint">Keys start with <code>eliza_</code>. Saved to the macOS Keychain when available; other platforms use the local SQLite account file.</p>
			<div class="tts-config__actions">
				<button type="button" data-action="cancel">Cancel</button>
				<button type="button" data-action="save" class="primary">Save</button>
			</div>
		`;

		const modal = new Modal({
			title: "Connect Eliza Cloud",
			body,
			initialFocusSelector: "[data-field=key]",
			onClose: () => resolve(),
		});

		const keyEl = body.querySelector<HTMLInputElement>("[data-field=key]")!;

		body.querySelector<HTMLButtonElement>("[data-action=open]")!
			.addEventListener("click", () => {
				void bunRpc.openUrlInBrowser({ url: DASHBOARD_URL });
			});
		body.querySelector<HTMLButtonElement>("[data-action=cancel]")!
			.addEventListener("click", () => modal.close());
		body.querySelector<HTMLButtonElement>("[data-action=save]")!
			.addEventListener("click", async () => {
				const key = keyEl.value.trim();
				if (!key) {
					toast("Paste an API key first", "error");
					return;
				}
				if (!key.startsWith("eliza_")) {
					toast("Eliza Cloud keys start with eliza_ — check the key and try again", "error");
					return;
				}
				try {
					await setSecretAndPersist(ELIZACLOUD_API_KEY, key);
					toast("Eliza Cloud key saved", "success");
					modal.close();
				} catch (err) {
					toast(userMessageFor(err), "error");
				}
			});
	});
}
