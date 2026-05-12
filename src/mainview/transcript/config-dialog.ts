// Configure the studio-wide transcript watcher. The banter agent (if any
// is running) pulls recent events from the feed and includes them in its
// LLM system context, so it can comment on the coding assistant's actual
// work instead of riffing on chat alone.

import { Modal, toast } from "../components/overlays";
import { bunRpc } from "../rpc";
import { userMessageFor } from "../core/errors";
import type { TranscriptConfig } from "../core/types";

export const DEFAULT_TRANSCRIPT: TranscriptConfig = {
	enabled: false,
	path: "",
};

export function pickTranscriptConfig(initial?: TranscriptConfig): Promise<TranscriptConfig | null> {
	return new Promise((resolve) => {
		let resolved = false;
		const resolveOnce = (v: TranscriptConfig | null): void => {
			if (resolved) return;
			resolved = true;
			resolve(v);
		};

		const body = document.createElement("div");
		body.className = "tts-config";
		body.innerHTML = `
			<p class="device-picker__intro">
				Watch a Claude Code or Codex session file. When enabled, the banter agent gets a running feed of what your coding assistant is doing — tool calls, edits, bash commands — and can comment on it live.
			</p>
			<label class="tts-config__row tts-config__row--inline">
				<input type="checkbox" data-field="enabled" />
				<span>Watch coding session</span>
			</label>
			<label class="tts-config__row">
				<span>Path to JSONL session file</span>
				<input type="text" data-field="path" placeholder="/Users/you/.claude/projects/&lt;slug&gt;/&lt;session-id&gt;.jsonl" />
				<small class="tts-config__hint">Claude Code stores these under <code>~/.claude/projects/&lt;project&gt;/&lt;session&gt;.jsonl</code> · Codex under <code>~/.codex/sessions/</code>. Use the active session file.</small>
			</label>
			<div class="tts-config__row tts-config__row--inline">
				<button type="button" data-action="auto-detect" class="auto-detect-btn">Auto-detect newest session</button>
				<small class="tts-config__hint" data-field="autoDetectResult"></small>
			</div>
			<div class="tts-config__footer">
				The watcher uses <code>tail -F</code> so it follows file rotation. We only forward summaries (tool name + key arg) — no source code leaves your machine.
			</div>
			<div class="tts-config__actions">
				<button type="button" data-action="cancel">Cancel</button>
				<button type="button" data-action="save" class="primary">Save</button>
			</div>
		`;

		const enabled = body.querySelector<HTMLInputElement>("[data-field=enabled]")!;
		const path = body.querySelector<HTMLInputElement>("[data-field=path]")!;
		const seed = initial ?? DEFAULT_TRANSCRIPT;
		enabled.checked = seed.enabled;
		path.value = seed.path;

		const modal = new Modal({
			title: "Coding feed",
			body,
			onClose: () => resolveOnce(null),
		});

		body.querySelector<HTMLButtonElement>("[data-action=cancel]")!.addEventListener("click", () => modal.close());

		const autoBtn = body.querySelector<HTMLButtonElement>("[data-action=auto-detect]")!;
		const autoResult = body.querySelector<HTMLElement>("[data-field=autoDetectResult]")!;
		autoBtn.addEventListener("click", async () => {
			autoBtn.disabled = true;
			autoBtn.textContent = "Scanning…";
			try {
				const result = await bunRpc.findActiveTranscriptSession({});
				if (result.path) {
					path.value = result.path;
					enabled.checked = true;
					const tool = result.tool ?? "session";
					const when = result.mtime
						? `${Math.round((Date.now() - result.mtime) / 1000)}s ago`
						: "";
					autoResult.textContent = `Found ${tool} session — modified ${when}`;
				} else {
					autoResult.textContent = result.error ?? "Nothing found";
					toast("No active session found", "info");
				}
			} catch (err) {
				autoResult.textContent = userMessageFor(err);
			} finally {
				autoBtn.disabled = false;
				autoBtn.textContent = "Auto-detect newest session";
			}
		});

		body.querySelector<HTMLButtonElement>("[data-action=save]")!.addEventListener("click", () => {
			resolveOnce({
				enabled: enabled.checked,
				path: path.value.trim(),
			});
			modal.close();
		});
	});
}
