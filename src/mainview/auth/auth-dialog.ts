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
			const loginSel = tab === "login";
			const signupSel = tab === "signup";
			body.innerHTML = `
				<div class="auth-dialog__tabs" role="tablist" aria-label="Account">
					<button type="button" class="auth-dialog__tab${loginSel ? " is-active" : ""}" role="tab" id="auth-tab-login" aria-selected="${loginSel}" aria-controls="auth-panel" tabindex="${loginSel ? "0" : "-1"}" data-tab="login">Sign in</button>
					<button type="button" class="auth-dialog__tab${signupSel ? " is-active" : ""}" role="tab" id="auth-tab-signup" aria-selected="${signupSel}" aria-controls="auth-panel" tabindex="${signupSel ? "0" : "-1"}" data-tab="signup">Create account</button>
				</div>
				<div id="auth-panel" class="auth-dialog__panel" role="tabpanel" tabindex="0" aria-labelledby="${tab === "login" ? "auth-tab-login" : "auth-tab-signup"}">
					<label class="auth-dialog__row">
						<span>Username</span>
						<input type="text" data-field="username" autocomplete="username" autocapitalize="off" />
					</label>
					<label class="auth-dialog__row">
						<span>Password</span>
						<input type="password" data-field="password" autocomplete="${tab === "login" ? "current-password" : "new-password"}" />
					</label>
					<div class="auth-dialog__error" data-region="error" role="alert" hidden></div>
					<div class="auth-dialog__actions">
						<button type="button" data-action="submit" class="primary">${tab === "login" ? "Sign in" : "Create account"}</button>
					</div>
					<p class="auth-dialog__hint">Local accounts only — your password and keys never leave this machine.</p>
				</div>
			`;

			const switchTab = (next: Tab): void => {
				tab = next;
				render();
				body.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus();
			};

			body.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((btn) => {
				btn.addEventListener("click", () => switchTab(btn.dataset["tab"] as Tab));
				btn.addEventListener("keydown", (e) => {
					const ev = e as KeyboardEvent;
					if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
						ev.preventDefault();
						switchTab(btn.dataset["tab"] === "login" ? "signup" : "login");
					} else if (ev.key === "Home") {
						ev.preventDefault();
						switchTab("login");
					} else if (ev.key === "End") {
						ev.preventDefault();
						switchTab("signup");
					}
				});
			});

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
			initialFocusSelector: "[data-field=username]",
			onClose: () => {
				if (!resolved) reject(new Error("auth-dialog-closed"));
			},
		});
	});
}
