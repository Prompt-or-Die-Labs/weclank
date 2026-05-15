// Promise-returning input dialog. Replaces `window.prompt()` for
// cases where we need:
//   - URL or path validation
//   - clipboard paste that works in CEF/WKWebView (window.prompt has
//     historical bugs around paste in some webviews)
//   - styled UI matching the rest of the app
//   - keyboard-friendly cancel (Esc) + confirm (Enter)
//
// Returns the trimmed value, or null if the user cancels.

import { Modal } from "./overlays";
import { escapeAttr, escapeHtml } from "./primitives";

export interface InputDialogOptions {
	title: string;
	/** Helper text shown above the input. May contain a brief HTML fragment. */
	body?: string;
	label: string;
	placeholder?: string;
	value?: string;
	type?: "text" | "url" | "password";
	confirmLabel?: string;
	/** Return a non-empty string to surface as an error and block confirm. */
	validate?: (raw: string) => string | null;
}

export function openInputDialog(opts: InputDialogOptions): Promise<string | null> {
	return new Promise((resolve) => {
		const body = document.createElement("div");
		body.className = "input-dialog";
		body.innerHTML = `
			${opts.body ? `<p class="input-dialog__body">${opts.body}</p>` : ""}
			<label class="input-dialog__field">
				<span>${escapeHtml(opts.label)}</span>
				<input
					type="${opts.type ?? "text"}"
					placeholder="${escapeAttr(opts.placeholder ?? "")}"
					value="${escapeAttr(opts.value ?? "")}"
					autocomplete="off"
					spellcheck="false"
				>
			</label>
			<div class="input-dialog__error" hidden></div>
			<div class="input-dialog__buttons">
				<button type="button" class="settings-action" data-act="cancel">Cancel</button>
				<button type="button" class="settings-action input-dialog__confirm" data-act="confirm">${escapeHtml(opts.confirmLabel ?? "OK")}</button>
			</div>
		`;

		let settled = false;
		const settle = (value: string | null): void => {
			if (settled) return;
			settled = true;
			modal.close();
			resolve(value);
		};

		const modal = new Modal({
			title: opts.title,
			body,
			initialFocusSelector: "input",
			onClose: () => settle(null),
		});

		const input = body.querySelector<HTMLInputElement>("input")!;
		const errEl = body.querySelector<HTMLElement>(".input-dialog__error")!;

		const tryConfirm = (): void => {
			const raw = input.value.trim();
			if (opts.validate) {
				const reason = opts.validate(raw);
				if (reason) {
					errEl.textContent = reason;
					errEl.hidden = false;
					input.focus();
					input.select();
					return;
				}
			}
			settle(raw);
		};

		body.querySelector<HTMLButtonElement>("[data-act=cancel]")?.addEventListener("click", () => settle(null));
		body.querySelector<HTMLButtonElement>("[data-act=confirm]")?.addEventListener("click", tryConfirm);
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				tryConfirm();
			} else if (e.key === "Escape") {
				e.preventDefault();
				settle(null);
			}
		});
		// Clear the error as the user types.
		input.addEventListener("input", () => {
			errEl.hidden = true;
			errEl.textContent = "";
		});
	});
}

export interface ConfirmDialogOptions {
	title: string;
	/** Body copy. Plain text — escaped before rendering. */
	body: string;
	/** Defaults to "OK". */
	confirmLabel?: string;
	/** Defaults to "Cancel". */
	cancelLabel?: string;
	/** Renders the confirm button as destructive. Use for delete-like actions. */
	destructive?: boolean;
}

/** Promise-returning confirm dialog. Replaces `window.confirm()` — Electrobun's
 *  WKWebView doesn't implement the JS dialog UI delegate, so `window.confirm`
 *  returns falsy without showing anything. Always returns a real boolean. */
export function openConfirmDialog(opts: ConfirmDialogOptions): Promise<boolean> {
	return new Promise((resolve) => {
		const body = document.createElement("div");
		body.className = "input-dialog";
		const confirmClass = opts.destructive
			? "settings-action settings-action--danger input-dialog__confirm"
			: "settings-action input-dialog__confirm";
		body.innerHTML = `
			<p class="input-dialog__body">${escapeHtml(opts.body)}</p>
			<div class="input-dialog__buttons">
				<button type="button" class="settings-action" data-act="cancel">${escapeHtml(opts.cancelLabel ?? "Cancel")}</button>
				<button type="button" class="${confirmClass}" data-act="confirm">${escapeHtml(opts.confirmLabel ?? "OK")}</button>
			</div>
		`;

		let settled = false;
		const settle = (value: boolean): void => {
			if (settled) return;
			settled = true;
			modal.close();
			resolve(value);
		};

		const modal = new Modal({
			title: opts.title,
			body,
			initialFocusSelector: ".input-dialog__confirm",
			onClose: () => settle(false),
		});

		body.querySelector<HTMLButtonElement>("[data-act=cancel]")?.addEventListener("click", () => settle(false));
		body.querySelector<HTMLButtonElement>("[data-act=confirm]")?.addEventListener("click", () => settle(true));
		body.addEventListener("keydown", (e) => {
			if (e.key === "Enter") { e.preventDefault(); settle(true); }
			else if (e.key === "Escape") { e.preventDefault(); settle(false); }
		});
	});
}

/** Convenience: URL-validating input dialog. Accepts https/http and
 *  rejects clearly-bad inputs early. Empty input cancels (returns null). */
export function openUrlInputDialog(opts: Omit<InputDialogOptions, "type" | "validate">): Promise<string | null> {
	return openInputDialog({
		...opts,
		type: "url",
		validate: (raw) => {
			if (!raw) return "URL required";
			try {
				const u = new URL(raw);
				if (u.protocol !== "https:" && u.protocol !== "http:") {
					return "URL must start with http:// or https://";
				}
				return null;
			} catch {
				return "Doesn't look like a valid URL";
			}
		},
	});
}
