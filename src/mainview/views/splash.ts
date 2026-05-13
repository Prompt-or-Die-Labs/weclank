// Splash view — full-screen pre-auth landing. Pure DOM, no canvas, no
// dependencies on studio state. Two CTAs that open the auth dialog
// pre-set to login or signup. Resolves when the user is authenticated.

import { openAuthDialog } from "../auth/auth-dialog";
import type { UserId } from "../core/ids";
import { PRODUCT_PROMISE, PRODUCT_TAGLINE, PRODUCT_VERSION } from "../product";

export function mountSplash(): Promise<{ id: UserId; username: string }> {
	return new Promise((resolve) => {
		const root = document.getElementById("app");
		if (!root) throw new Error("#app missing");
		root.innerHTML = "";

		const splash = document.createElement("div");
		splash.className = "splash";
		splash.innerHTML = `
			<div class="splash__inner">
				<div class="splash__brand">WE<span>/</span>CLANK</div>
				<p class="splash__tagline">${PRODUCT_PROMISE}. ${PRODUCT_TAGLINE}</p>
				<p class="splash__badge">Desktop app · macOS / Linux / Windows · streaming uses ffmpeg when you go live</p>
				<div class="splash__cta">
					<button class="primary" data-action="signin">Sign in</button>
					<button class="secondary" data-action="signup">Create account</button>
				</div>
				<div class="splash__features">
					<div>Coding-feed awareness from Claude Code or Codex JSONL sessions.</div>
					<div>Host mic and viewer-chat context for a co-host that knows what just happened.</div>
					<div>Overlay cues, captions, music, and chat responses driven by the co-host loop.</div>
					<div>Recording review and post-stream outputs so each stream creates the next session's memory.</div>
				</div>
			</div>
			<div class="splash__footer">
				<span>local-first · keychain-backed secrets · apache 2.0</span>
				<span>v${PRODUCT_VERSION}</span>
			</div>
		`;
		root.appendChild(splash);

		const open = async (tab: "login" | "signup"): Promise<void> => {
			try {
				const user = await openAuthDialog(tab);
				splash.remove();
				resolve(user);
			} catch {
				// Dialog dismissed — leave splash up.
			}
		};
		splash.querySelector<HTMLButtonElement>('[data-action="signin"]')!.addEventListener("click", () => void open("login"));
		splash.querySelector<HTMLButtonElement>('[data-action="signup"]')!.addEventListener("click", () => void open("signup"));
	});
}
