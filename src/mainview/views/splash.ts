// Splash view — full-screen pre-auth landing. Pure DOM, no canvas, no
// dependencies on studio state. Two CTAs that open the auth dialog
// pre-set to login or signup. Resolves when the user is authenticated.

import { openAuthDialog } from "../auth/auth-dialog";
import type { UserId } from "../core/ids";

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
				<p class="splash__tagline">Open-source streaming studio with AI co-hosts. Local-first, single binary, your machine, your data.</p>
				<div class="splash__cta">
					<button class="primary" data-action="signin">Sign in</button>
					<button class="secondary" data-action="signup">Create account</button>
				</div>
				<div class="splash__features">
					<div>Multi-source compositing → hardware-encoded RTMP egress to one or many destinations.</div>
					<div>AI co-host with streaming TTS, viewer-chat awareness, mic transcription, and tool-driven overlays.</div>
					<div>Coding-feed integration so the agent reacts to what Claude Code or Codex is doing in real time.</div>
					<div>Music generation (Suno), captions, QR codes, and stream overlays — all driven from inside the app.</div>
				</div>
			</div>
			<div class="splash__footer">
				<span>local-first · sqlite · apache 2.0</span>
				<span>v0.1</span>
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
