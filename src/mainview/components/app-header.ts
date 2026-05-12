// Top bar: STUDIO/LIVE wordmark (centered), stream-status dropdown +
// GO LIVE button (right), event title + user menu (left). Vercel/shadcn
// monochrome — no chrome, hairline borders only.

import { Component } from "../core/component";
import { Icons } from "../core/icons";
import { studio } from "../state/studio-store";
import { authStore } from "../auth/auth-store";
import type { StreamQuality, StudioState } from "../core/types";
import { Popover, toast } from "./overlays";
import { connectOpenRouterOAuth, OPENROUTER_KEY } from "../auth/openrouter-oauth";
import { openOpenAiApiKeyDialog, OPENAI_API_KEY } from "../auth/openai-api";
import { hasSecret } from "../auth/secrets-cache";
import { egressController } from "../streaming/egress";
import { pickRtmpDestination } from "../streaming/rtmp-config-dialog";
import { localRecorder } from "../streaming/recorder";
import { StudioError, userMessageFor } from "../core/errors";
import { bunRpc } from "../rpc";
import { openGoLiveFailedDialog } from "./go-live-failed-dialog";
import { openSettingsDialog } from "./settings-dialog";

interface State {
	stream: StudioState["stream"];
	username: string;
	/** Wall-clock at which the current live session began (ms since
	 * epoch). null when not live. Re-rendered every second so the
	 * displayed elapsed time stays current. */
	liveStartedAt: number | null;
	nowMs: number;
}

type UtilityKind = "studio" | "chat" | "producer" | "stats" | "overlay" | "prompter";

const UTILITY_ITEMS: Array<{ kind: UtilityKind; label: string }> = [
	{ kind: "studio", label: "Studio Dock" },
	{ kind: "chat", label: "Chat" },
	{ kind: "producer", label: "Producer" },
	{ kind: "stats", label: "Monitor" },
	{ kind: "overlay", label: "Overlay" },
	{ kind: "prompter", label: "Prompter" },
];

export class AppHeader extends Component<State> {
	private tickTimer: ReturnType<typeof setInterval> | null = null;

	constructor() {
		super({
			stream: studio.state.stream,
			username: authStore.user?.username ?? "",
			liveStartedAt: studio.state.stream.live ? Date.now() : null,
			nowMs: Date.now(),
		});
		studio.select((s) => s.stream, (stream) => {
			// Reset the timer when live edges true; null it when edges false.
			const wasLive = this.state.stream.live;
			this.setState({
				stream,
				liveStartedAt: stream.live ? (wasLive ? this.state.liveStartedAt : Date.now()) : null,
			});
		});
		authStore.select((s) => s.user, (user) => this.setState({ username: user?.username ?? "" }));
	}

	protected afterMount(): void {
		this.el.setAttribute("role", "banner");
		// Tick the displayed elapsed time once a second while live.
		this.tickTimer = setInterval(() => {
			if (this.state.liveStartedAt !== null) this.setState({ nowMs: Date.now() });
		}, 1000);
	}

	protected beforeDestroy(): void {
		if (this.tickTimer) clearInterval(this.tickTimer);
	}

	protected rootClass(): string {
		return "app-header";
	}

	protected template(): string {
		const { stream, username, liveStartedAt, nowMs } = this.state;
		const initial = username ? username[0]!.toUpperCase() : "?";
		const elapsed = liveStartedAt !== null ? formatElapsed(nowMs - liveStartedAt) : null;
		return `
			<div class="app-header__left">
				<button class="event-title" id="event-title" aria-label="Edit event">
					<span class="event-title__text">${stream.title}</span>
					<span class="event-title__caret">${Icons.chevronDown()}</span>
				</button>
			</div>
			<div class="app-header__center">
				<span class="brand-mark">WECLANK<span class="brand-mark__pill">LIVE</span></span>
			</div>
			<div class="app-header__right">
				${stream.recording ? `<span class="rec-badge" aria-label="Recording to disk">REC</span>` : ""}
				${elapsed ? `<span class="stream-timer tabular" aria-label="Time live">${elapsed}</span>` : ""}
				<button class="utilities-btn" id="utilities-menu" aria-label="Open utility windows">Utilities</button>
				<button class="rec-btn ${stream.recording ? "rec-btn--on" : ""}" id="rec-toggle" aria-label="${stream.recording ? "Stop recording to disk" : "Start recording to disk"}" aria-pressed="${stream.recording ? "true" : "false"}">${stream.recording ? "STOP" : "REC"}</button>
				<button class="stream-status" id="stream-status" aria-label="Stream settings">
					<div class="stream-status__row">
						<span class="stream-status__title">${stream.live ? "LIVE" : "READY"}</span>
						<span class="stream-status__quality">${stream.quality}</span>
					</div>
					<span class="stream-status__caret">${Icons.chevronDown()}</span>
				</button>
				<button class="go-live ${stream.live ? "go-live--on" : ""}" id="go-live" aria-label="${stream.live ? "Stop stream" : "Go live"}">${stream.live ? "STOP" : "GO LIVE"}</button>
				<button class="participant-stack__avatar" id="user-menu" title="${username}" aria-label="Account menu">${initial}</button>
			</div>
		`;
	}

	protected bind(): void {
		this.on(this.$("#event-title"), "click", (e) => this.openEventMenu(e.currentTarget as HTMLElement));
		this.on(this.$("#stream-status"), "click", (e) => this.openStreamMenu(e.currentTarget as HTMLElement));
		this.on(this.$("#utilities-menu"), "click", (e) => this.openUtilitiesMenu(e.currentTarget as HTMLElement));
		this.on(this.$("#go-live"), "click", () => this.toggleLive());
		this.on(this.$("#rec-toggle"), "click", () => this.toggleRecording());
		this.on(this.$("#user-menu"), "click", (e) => this.openUserMenu(e.currentTarget as HTMLElement));
	}

	private openUserMenu(anchor: HTMLElement): void {
		const connected = hasSecret(OPENROUTER_KEY);
		const openAiSaved = hasSecret(OPENAI_API_KEY);
		const menu = document.createElement("div");
		menu.className = "menu";
		menu.innerHTML = `
			<div class="menu__section">Signed in as ${this.state.username}</div>
			<button class="menu__item" data-act="openrouter">
				OpenRouter
				<small>${connected ? "● connected" : "○ not connected"}</small>
			</button>
			<button class="menu__item" data-act="openai-key">
				OpenAI API key
				<small>${openAiSaved ? "● saved" : "○ not set"}</small>
			</button>
			<button class="menu__item" data-act="settings">Settings…</button>
			<div class="menu__divider"></div>
			<button class="menu__item" data-act="signout">Sign out</button>
			<button class="menu__item menu__item--danger" data-act="delete">Delete account</button>
		`;
		const popover = new Popover({ anchor, content: menu });
		menu.querySelectorAll<HTMLButtonElement>("[data-act]").forEach((btn) => {
			btn.addEventListener("click", async () => {
				popover.dismiss();
				switch (btn.dataset["act"]) {
					case "openrouter":
						await this.connectOpenRouter();
						break;
					case "openai-key":
						await openOpenAiApiKeyDialog();
						break;
					case "settings":
						openSettingsDialog();
						break;
					case "signout":
						authStore.logout();
						location.reload();
						break;
					case "delete":
						if (window.confirm("Permanently delete this account and all its scenes / agents / keys?")) {
							await authStore.deleteAccount();
							location.reload();
						}
						break;
				}
			});
		});
	}

	private openUtilitiesMenu(anchor: HTMLElement): void {
		const menu = document.createElement("div");
		menu.className = "menu menu--utilities";
		menu.innerHTML = `
			<div class="menu__section">Utility windows</div>
			${UTILITY_ITEMS.map((item) => `<button class="menu__item" data-kind="${item.kind}">${item.label}</button>`).join("")}
			<div class="menu__divider"></div>
			<button class="menu__item" data-close="all">Close utilities</button>
		`;
		const popover = new Popover({ anchor, content: menu });
		menu.querySelectorAll<HTMLButtonElement>("[data-kind]").forEach((btn) => {
			btn.addEventListener("click", async () => {
				popover.dismiss();
				const kind = btn.dataset["kind"] as UtilityKind;
				try {
					await bunRpc.openStudioUtilityWindow({
						kind,
						clickThrough: kind === "overlay",
						alwaysOnTop: kind === "overlay" || kind === "prompter",
					});
				} catch (err) {
					toast(`Utility failed: ${userMessageFor(err)}`, "error");
				}
			});
		});
		menu.querySelector<HTMLButtonElement>("[data-close]")?.addEventListener("click", async () => {
			popover.dismiss();
			try {
				await bunRpc.closeStudioUtilityWindows({});
				toast("Utility windows closed");
			} catch (err) {
				toast(`Close failed: ${userMessageFor(err)}`, "error");
			}
		});
	}

	private async connectOpenRouter(): Promise<void> {
		toast("Opening OpenRouter login in your browser…", "info");
		try {
			await connectOpenRouterOAuth();
			toast("OpenRouter connected", "success");
		} catch (err) {
			toast(`OpenRouter connect failed: ${userMessageFor(err)}`, "error");
		}
	}

	private openEventMenu(anchor: HTMLElement): void {
		const menu = document.createElement("div");
		menu.className = "menu";
		menu.innerHTML = `
			<button class="menu__item" data-act="rename">Rename event…</button>
			<button class="menu__item" data-act="destinations">Stream destinations…</button>
		`;
		const popover = new Popover({ anchor, content: menu });
		menu.querySelectorAll<HTMLButtonElement>("[data-act]").forEach((btn) => {
			btn.addEventListener("click", async () => {
				popover.dismiss();
				switch (btn.dataset["act"]) {
					case "rename": {
						const next = window.prompt("Rename event", studio.state.stream.title);
						if (next?.trim()) studio.setStream({ title: next.trim() });
						break;
					}
					case "destinations":
						await pickRtmpDestination({ intent: "settings" });
						break;
				}
			});
		});
	}

	private openStreamMenu(anchor: HTMLElement): void {
		const quality = studio.state.stream.quality;
		const menu = document.createElement("div");
		menu.className = "menu";
		menu.innerHTML = `
			<div class="menu__section">Quality</div>
			<button class="menu__item" data-quality="480p" aria-pressed="${quality === "480p"}">480p</button>
			<button class="menu__item" data-quality="720p" aria-pressed="${quality === "720p"}">720p</button>
			<button class="menu__item" data-quality="1080p" aria-pressed="${quality === "1080p"}">1080p</button>
			<div class="menu__section">Recording</div>
			<button class="menu__item" data-record="toggle">${studio.state.stream.recording || localRecorder.isRecording ? "Stop local recording" : "Start local recording"}</button>
		`;
		const popover = new Popover({ anchor, content: menu });
		menu.querySelectorAll<HTMLButtonElement>("[data-quality]").forEach((btn) => {
			btn.addEventListener("click", () => {
				popover.dismiss();
				const next = btn.dataset["quality"] as StreamQuality;
				studio.setStream({ quality: next });
				toast(`Quality set to ${next}`, "success");
			});
		});
		menu.querySelector<HTMLButtonElement>("[data-record]")?.addEventListener("click", () => {
			popover.dismiss();
			void this.toggleRecording();
		});
	}

	private async toggleLive(): Promise<void> {
		const current = studio.state.stream.live;
		if (!current) {
			const result = await pickRtmpDestination();
			if (!result) return;
			toast(`Connecting to ${result.destinations.length} destination${result.destinations.length > 1 ? "s" : ""}…`, "info");
			try {
				await egressController.start(result.destinations);
				studio.setStream({ live: true });
				toast(`Live on ${result.destinations.length} destination${result.destinations.length > 1 ? "s" : ""}`, "success");
			} catch (err) {
				const detail = err instanceof StudioError ? err.message : userMessageFor(err);
				openGoLiveFailedDialog(detail);
			}
		} else {
			try {
				await egressController.stop();
			} catch (err) {
				console.warn("[egress] stop failed", err);
			}
			studio.setStream({ live: false });
			toast("Stream stopped");
		}
	}

	private async toggleRecording(): Promise<void> {
		const recording = studio.state.stream.recording || localRecorder.isRecording;
		if (recording) {
			try {
				const result = await localRecorder.stop();
				if (result.canceled) toast("Recording discarded", "info");
			} catch (err) {
				toast(`Stop failed: ${userMessageFor(err)}`, "error");
			}
		} else {
			try {
				await localRecorder.start();
				toast("Recording to disk", "success");
			} catch (err) {
				toast(`Recording failed: ${userMessageFor(err)}`, "error");
			}
		}
	}
}

/** Pretty-print elapsed milliseconds as HH:MM:SS (or MM:SS under an hour).
 * Tabular numerals in CSS keep the width stable as the digits roll. */
function formatElapsed(ms: number): string {
	const total = Math.floor(ms / 1000);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	const pad = (n: number): string => n.toString().padStart(2, "0");
	return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
