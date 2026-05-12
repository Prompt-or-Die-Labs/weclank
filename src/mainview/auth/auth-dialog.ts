// Combined login + signup dialog. Tab switch at the top. Boot-time fires
// this when no user is in localStorage; the studio waits for it to
// resolve before mounting. Stage 3 wraps this in a proper splash page —
// for now it's a modal over a black background.

import { Modal } from "../components/overlays";
import { authStore } from "./auth-store";
import { userMessageFor } from "../core/errors";
import type { UserId } from "../core/ids";

type Tab = "login" | "signup";

export function openAuthDialog(initialTab: Tab = "login"): Promise<{ id: UserId; username: string }> {
	return new Promise((resolve, reject) => {
		let resolved = false;
		let tab: Tab = initialTab;

		const body = document.createElement("div");
		body.className = "auth-dialog";

		const render = (): void => {
			body.innerHTML = `
				<div class="auth-dialog__tabs">
					<button class="auth-dialog__tab${tab === "login" ? " is-active" : ""}" data-tab="login">Sign in</button>
					<button class="auth-dialog__tab${tab === "signup" ? " is-active" : ""}" data-tab="signup">Create account</button>
				</div>
				<label class="auth-dialog__row">
					<span>Username</span>
					<input type="text" data-field="username" autocomplete="username" autocapitalize="off" />
				</label>
				<label class="auth-dialog__row">
					<span>Password</span>
					<input type="password" data-field="password" autocomplete="${tab === "login" ? "current-password" : "new-password"}" />
				</label>
				<div class="auth-dialog__error" data-region="error" hidden></div>
				<div class="auth-dialog__actions">
					<button type="button" data-action="submit" class="primary">${tab === "login" ? "Sign in" : "Create account"}</button>
				</div>
				<p class="auth-dialog__hint">Local accounts only — your password and keys never leave this machine.</p>
			`;
			body.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((btn) =>
				btn.addEventListener("click", () => { tab = btn.dataset["tab"] as Tab; render(); }),
			);
			body.querySelector<HTMLButtonElement>("[data-action=submit]")!.addEventListener("click", submit);
			body.querySelector<HTMLInputElement>("[data-field=password]")!.addEventListener("keydown", (e) => {
				if ((e as KeyboardEvent).key === "Enter") submit();
			});
		};

		const submit = async (): Promise<void> => {
			const usernameEl = body.querySelector<HTMLInputElement>("[data-field=username]")!;
			const passwordEl = body.querySelector<HTMLInputElement>("[data-field=password]")!;
			const errorEl = body.querySelector<HTMLElement>("[data-region=error]")!;
			const username = usernameEl.value.trim();
			const password = passwordEl.value;
			errorEl.hidden = true;
			try {
				const user = tab === "login"
					? await authStore.login(username, password)
					: await authStore.signup(username, password);
				resolved = true;
				modal.close();
				resolve(user);
			} catch (err) {
				errorEl.textContent = userMessageFor(err);
				errorEl.hidden = false;
			}
		};

		render();

		const modal = new Modal({
			title: "Weclank",
			body,
			onClose: () => {
				if (!resolved) reject(new Error("auth-dialog-closed"));
			},
		});
	});
}
