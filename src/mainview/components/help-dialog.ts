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
				<dt><kbd>⌘ K</kbd></dt><dd>Command palette — type to filter; <kbd>↑</kbd><kbd>↓</kbd> move; <kbd>PgUp</kbd><kbd>PgDn</kbd> page; <kbd>Home</kbd><kbd>End</kbd> jump; <kbd>Enter</kbd> runs</dd>
				<dt><kbd>⌘ ⇧ L</kbd></dt><dd>Go Live / stop streaming</dd>
				<dt><kbd>⌘ ⇧ R</kbd></dt><dd>Start / stop local recording — you pick a folder; the file is <strong>MP4</strong> (H.264 + AAC) produced by ffmpeg after you stop. When you stop, a <strong>Review recording</strong> window opens: preview, set start/end for one trim, save a trimmed copy, delete the file, or share (system share sheet when available, otherwise path to clipboard). MediaRecorder still captures WebM internally, then the main process transcodes.</dd>
				<dt><kbd>[</kbd> <kbd>]</kbd></dt><dd>Cycle the right-sidebar tab</dd>
				<dt><kbd>↑↓←→</kbd></dt><dd>Nudge the selected source (Shift = 10×)</dd>
				<dt><kbd>Esc</kbd></dt><dd>Deselect source</dd>
				<dt><kbd>\`</kbd> (backtick)</dt><dd>Toggle the private studio tray — off-stream chat with agents (mic lines, your notes, replies). Ignored while focus is in an input or textarea.</dd>
			</dl>
		</section>
		<section class="help-dialog__section">
			<h3>Screen reader &amp; keyboard</h3>
			<ul>
				<li>Use <strong>Skip to program stage</strong> at the top of the page to jump past the header and scene list.</li>
				<li>The preview canvas lives in a <code>main</code> landmark labeled &quot;Program preview and stage&quot;.</li>
				<li>Scenes are a <code>nav</code> with a list; the right sidebar uses a proper tab pattern (<kbd>←</kbd><kbd>→</kbd> between tabs when a tab is focused).</li>
				<li>Sign-in uses tabs with the same arrow-key pattern.</li>
				<li>The command palette is a <code>combobox</code>: focus stays in the filter field; arrow keys move virtual focus (<code>aria-activedescendant</code>) through commands.</li>
				<li>Modal dialogs can move initial focus to the primary field (command palette filter, import JSON, sign-in username) instead of the close control.</li>
				<li>The setup checklist row sets <code>aria-busy</code> while ffmpeg is being probed on the main process.</li>
				<li>The guided setup wizard wraps the ffmpeg probe in a live <code>status</code> region and toggles <code>aria-busy</code> on that block while the check runs.</li>
				<li>Toasts announce briefly via a polite live region (errors are assertive).</li>
			</ul>
		</section>
		<section class="help-dialog__section">
			<h3>Where things live</h3>
			<dl>
				<dt>Database</dt><dd data-field="dbPath">…</dd>
				<dt>API keys & RTMP secrets</dt><dd>Stored in plaintext in the SQLite <code>user_secrets</code> table on this machine. Anyone with read access to the database file can read them — same practical model as shell history. Use full-disk encryption on laptops you care about.</dd>
				<dt>Account password</dt><dd>argon2id hash in <code>users.password_hash</code>. Forgot it? Delete the file and sign up again — local-only auth has no reset.</dd>
			</dl>
		</section>
		<section class="help-dialog__section">
			<h3>AI providers</h3>
			<p><strong>OpenRouter</strong> (account menu or Settings): OAuth covers TTS, mic transcription, and the default banter LLM when an agent uses the OpenRouter provider.</p>
			<p><strong>OpenAI</strong> (Settings → Save OpenAI API key): standard platform <code>sk-</code> key — same as Codex / <code>OPENAI_API_KEY</code>. In Weclank it powers Chat Completions when an agent's LLM provider is OpenAI; <a href="https://platform.openai.com/docs/guides/images" target="_blank" rel="noopener">Images</a> for broadcast-image tools; OpenAI Speech when you pick that TTS provider in Voice settings; and mic transcription when you set the agent's banter STT to OpenAI (e.g. <code>whisper-1</code>). Each path uses this stored key — no separate env var in the app bundle.</p>
		</section>
		<section class="help-dialog__section">
			<h3>MVP scope</h3>
			<p>Weclank targets local-first compositing, hardware-assisted RTMP to one or many destinations, and AI-assisted overlays — not a full replacement for OBS's plugin ecosystem (no NDI ingest, no cloud project sync, minimal advanced audio busing).</p>
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
