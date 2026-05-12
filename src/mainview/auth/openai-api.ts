// OpenAI platform API key — same shape as `OPENAI_API_KEY` for Codex CLI /
// and the rest of the OpenAI HTTP API (Chat Completions, Images, Audio, etc.
// — see https://platform.openai.com/docs/guides/images ). Stored in
// `user_secrets` under key `openai`. In this app, `getSecret("openai")` is
// read for banter LLM when `BanterConfig.llmProvider === "openai"`; other
// features may extend use of the same credential later.

import { Modal, toast } from "../components/overlays";
import { setSecretAndPersist } from "./secrets-cache";
import { userMessageFor } from "../core/errors";

export const OPENAI_API_KEY = "openai";

/** Modal: paste `sk-…` key, save to SQLite + secrets cache. */
export async function openOpenAiApiKeyDialog(): Promise<void> {
	return new Promise((resolve) => {
		const body = document.createElement("div");
		body.className = "tts-config";
		body.innerHTML = `
			<p class="device-picker__intro">Paste an <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">OpenAI API key</a> (starts with <code>sk-</code>) — same credential as Codex CLI / <code>OPENAI_API_KEY</code>. On OpenAI's platform this key type can authenticate <strong>Chat Completions</strong>, <strong>Images</strong> (<a href="https://platform.openai.com/docs/guides/images" target="_blank" rel="noopener">guide</a>), <strong>audio</strong> (TTS/STT), and other <code>/v1</code> APIs your account allows. In Weclank, this secret is used today when an agent's banter <strong>LLM provider</strong> is OpenAI; pick model ids from the <a href="https://platform.openai.com/docs/models" target="_blank" rel="noopener">model list</a>.</p>
			<label class="tts-config__row">
				<span>API key</span>
				<input type="password" data-field="key" autocomplete="off" spellcheck="false" placeholder="sk-…" />
			</label>
			<p class="tts-config__hint">Stored in your local SQLite account file (plaintext). Mic transcription still uses OpenRouter unless you change that separately.</p>
			<div class="tts-config__actions">
				<button type="button" data-action="cancel">Cancel</button>
				<button type="button" data-action="save" class="primary">Save</button>
			</div>
		`;

		const modal = new Modal({
			title: "OpenAI API key",
			body,
			initialFocusSelector: "[data-field=key]",
			onClose: () => resolve(),
		});

		const keyEl = body.querySelector<HTMLInputElement>("[data-field=key]")!;

		body.querySelector<HTMLButtonElement>("[data-action=cancel]")!.addEventListener("click", () => modal.close());
		body.querySelector<HTMLButtonElement>("[data-action=save]")!.addEventListener("click", async () => {
			const key = keyEl.value.trim();
			if (!key) {
				toast("Paste an API key first", "error");
				return;
			}
			if (!key.startsWith("sk-")) {
				toast("OpenAI keys usually start with sk- — check the key and try again", "error");
				return;
			}
			try {
				await setSecretAndPersist(OPENAI_API_KEY, key);
				toast("OpenAI API key saved", "success");
				modal.close();
			} catch (err) {
				toast(userMessageFor(err), "error");
			}
		});
	});
}
