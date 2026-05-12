// Thin banners for AI-path degradation (separate from broadcast / RTMP).

import { Component } from "../core/component";
import { getAiDegradedMessage, setAiDegradedMessage, subscribeStudioHealth } from "../studio-health";
import { connectOpenRouterOAuth, OPENROUTER_KEY } from "../auth/openrouter-oauth";
import { openOpenAiApiKeyDialog, OPENAI_API_KEY } from "../auth/openai-api";
import { hasSecret } from "../auth/secrets-cache";
import { studio } from "../state/studio-store";
import { toast } from "./overlays";
import { userMessageFor } from "../core/errors";

interface State {
	message: string | null;
	showOpenRouterNudge: boolean;
}

export class StudioHealthBanner extends Component<State> {
	constructor() {
		super({
			message: getAiDegradedMessage(),
			showOpenRouterNudge: false,
		});
	}

	protected rootClass(): string {
		return "studio-health-banner";
	}

	protected template(): string {
		const parts: string[] = [];
		if (this.state.message) {
			parts.push(`
				<div class="studio-health-banner__row studio-health-banner__row--warn" role="status" aria-live="polite">
					<strong>AI path</strong>
					<span>${escapeHtml(this.state.message)}</span>
					<span class="studio-health-banner__note">Your RTMP encode keeps running — this only affects co-host / tools using the network.</span>
					<button type="button" class="studio-health-banner__dismiss" data-dismiss="ai">Dismiss</button>
				</div>
			`);
		}
		if (this.state.showOpenRouterNudge) {
			parts.push(`
				<div class="studio-health-banner__row studio-health-banner__row--info" role="note">
					<strong>Optional</strong>
					<span>Connect OpenRouter or save an OpenAI API key so banter agents can call an LLM.</span>
					<button type="button" class="studio-health-banner__link" data-connect="or">OpenRouter…</button>
					<button type="button" class="studio-health-banner__link" data-connect="oa">OpenAI key…</button>
					<button type="button" class="studio-health-banner__dismiss" data-dismiss="nudge">Dismiss</button>
				</div>
			`);
		}
		if (parts.length === 0) return "";
		return parts.join("");
	}

	protected afterMount(): void {
		this.track(subscribeStudioHealth(() => {
			this.setState({ message: getAiDegradedMessage() });
		}));
		this.syncNudge();
		this.track(
			studio.select(
				(s) => `${s.studioPrefs?.focusMode ?? "full"}:${countAgents(s)}`,
				() => this.syncNudge(),
			),
		);
	}

	private syncNudge(): void {
		let dismissed = false;
		try {
			dismissed = localStorage.getItem("weclank.openRouterNudge.dismissed") === "1";
		} catch {
			dismissed = false;
		}
		const broadcast = studio.state.studioPrefs?.focusMode === "broadcast";
		const connected = hasSecret(OPENROUTER_KEY) || hasSecret(OPENAI_API_KEY);
		const agents = countAgents(studio.state);
		const show = !dismissed && broadcast && !connected && agents > 0;
		this.setState({ showOpenRouterNudge: show });
	}

	protected bind(): void {
		this.on(this.el, "click", (e) => {
			const t = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-dismiss]");
			if (t?.dataset["dismiss"] === "ai") {
				setAiDegradedMessage(null);
			}
			if (t?.dataset["dismiss"] === "nudge") {
				try {
					localStorage.setItem("weclank.openRouterNudge.dismissed", "1");
				} catch {
					/* noop */
				}
				this.setState({ showOpenRouterNudge: false });
			}
			const c = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-connect]");
			if (c?.dataset["connect"] === "or") {
				void connectOpenRouterOAuth()
					.then(() => {
						toast("OpenRouter connected", "success");
						this.setState({ showOpenRouterNudge: false });
					})
					.catch((err) => toast(userMessageFor(err), "error"));
			}
			if (c?.dataset["connect"] === "oa") {
				void openOpenAiApiKeyDialog().then(() => {
					if (hasSecret(OPENAI_API_KEY)) this.setState({ showOpenRouterNudge: false });
				});
			}
		});
	}
}

function countAgents(s: { participants: Record<string, { isAgent?: boolean }> }): number {
	return Object.values(s.participants).filter((p) => p.isAgent).length;
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}
