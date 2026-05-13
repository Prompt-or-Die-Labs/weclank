// First-run checklist: co-host loop first, broadcast dependencies second.

import { Component } from "../core/component";
import { participantId } from "../core/ids";
import { studio } from "../state/studio-store";
import { bunRpc } from "../rpc";
import { getSavedRtmpDestinationCount } from "../streaming/rtmp-config-dialog";
import { openSettingsDialog } from "./settings-dialog";
import { openSetupWizard } from "./setup-wizard";
import { ffmpegInstallHint } from "../platform";
import { toast } from "./overlays";
import type { StudioFocusMode } from "../core/types";

const HOST_ID = participantId("host");
const DISMISS_KEY = "weclank.setupStrip.dismissed";

interface State {
	dismissed: boolean;
	ffmpegOk: boolean | null;
	ffmpegLine: string;
	/** True while `getFfmpegProbe` is in flight (shows `aria-busy` on the strip). */
	ffmpegProbePending: boolean;
	rtmpCount: number;
	hostCameraOff: boolean;
	focusMode: StudioFocusMode;
	agentCount: number;
	transcriptEnabled: boolean;
}

export class SetupChecklistStrip extends Component<State> {
	constructor() {
		super({
			dismissed: readDismissed(),
			ffmpegOk: null,
			ffmpegLine: "",
			ffmpegProbePending: true,
			rtmpCount: getSavedRtmpDestinationCount(),
			hostCameraOff: studio.state.participants[HOST_ID]?.cameraOff ?? true,
			focusMode: studio.state.studioPrefs?.focusMode ?? "cohost",
			agentCount: countAgents(),
			transcriptEnabled: studio.state.transcript?.enabled ?? false,
		});
		studio.select(
			(s) => ({
				hostCameraOff: s.participants[HOST_ID]?.cameraOff ?? true,
				focusMode: s.studioPrefs?.focusMode ?? "cohost",
				agentCount: Object.values(s.participants).filter((p) => p.isAgent).length,
				transcriptEnabled: s.transcript?.enabled ?? false,
			}),
			(patch) => this.setState(patch),
		);
	}

	protected rootClass(): string {
		return "setup-strip";
	}

	protected template(): string {
		if (this.state.dismissed) return `<div class="setup-strip setup-strip--empty" aria-hidden="true"></div>`;
		const ff =
			this.state.ffmpegOk === null
				? "Checking ffmpeg…"
				: this.state.ffmpegOk
					? `ffmpeg OK`
					: "ffmpeg missing";
		const rtmp = this.state.rtmpCount > 0 ? `${this.state.rtmpCount} RTMP destination(s)` : "No RTMP channels saved";
		const cam = this.state.hostCameraOff ? "Host webcam off" : "Host webcam on";
		const agents = this.state.agentCount > 0 ? `${this.state.agentCount} co-host${this.state.agentCount === 1 ? "" : "s"}` : "No co-host yet";
		const transcript = this.state.transcriptEnabled ? "Coding feed on" : "Coding feed off";
		const ffDetail = this.state.ffmpegOk === false ? `<span class="setup-strip__detail">${escapeHtmlPlain(this.state.ffmpegLine)}</span>` : "";
		const ffCopy =
			this.state.ffmpegOk === false
				? `<button type="button" class="setup-strip__btn setup-strip__btn--ghost" data-action="copy-ffmpeg" title="Copy suggested install command">Copy ffmpeg install</button>`
				: "";
		const broadcastHint =
			this.state.focusMode === "broadcast"
				? `<span class="setup-strip__hint">Broadcast-only mode keeps co-host setup out of the first surface; switch focus in Settings.</span>`
				: "";
		return `
			<div class="setup-strip__row" role="region" aria-label="Setup checklist" aria-busy="${this.state.ffmpegProbePending ? "true" : "false"}">
				<span class="setup-strip__label">Setup</span>
				<span class="setup-strip__chip ${this.state.agentCount > 0 ? "ok" : "warn"}">${escapeHtmlPlain(agents)}</span>
				<span class="setup-strip__chip ${this.state.transcriptEnabled ? "ok" : "warn"}">${escapeHtmlPlain(transcript)}</span>
				<span class="setup-strip__chip ${chipClass(this.state.ffmpegOk)}">${ff}</span>
				${ffDetail}
				${ffCopy}
				<span class="setup-strip__chip ${this.state.rtmpCount > 0 ? "ok" : "warn"}">${escapeHtmlPlain(rtmp)}</span>
				<span class="setup-strip__chip ${this.state.hostCameraOff ? "warn" : "ok"}">${escapeHtmlPlain(cam)}</span>
				${broadcastHint}
				<span class="setup-strip__spacer"></span>
				<button type="button" class="setup-strip__btn" data-action="wizard">Guided setup</button>
				<button type="button" class="setup-strip__btn" data-action="settings">Settings</button>
				<button type="button" class="setup-strip__btn setup-strip__btn--ghost" data-action="dismiss">Dismiss bar</button>
			</div>
		`;
	}

	protected bind(): void {
		this.on(this.el, "click", (e) => {
			const t = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-action]");
			if (!t) return;
			switch (t.dataset["action"]) {
				case "copy-ffmpeg": {
					const { copy, label } = ffmpegInstallHint();
					void navigator.clipboard.writeText(copy).then(
						() => toast(`Copied ${label}`, "success"),
						() => toast(copy, "info"),
					);
					break;
				}
				case "wizard":
					void openSetupWizard();
					break;
				case "settings":
					openSettingsDialog();
					break;
				case "dismiss":
					try {
						localStorage.setItem(DISMISS_KEY, "1");
					} catch {
						/* unavailable */
					}
					this.setState({ dismissed: true });
					break;
			}
		});
	}

	protected afterMount(): void {
		void this.refreshFfmpeg();
		const id = window.setInterval(() => {
			this.setState({ rtmpCount: getSavedRtmpDestinationCount() });
			void this.refreshFfmpeg();
		}, 8000);
		this.track(() => clearInterval(id));
	}

	private async refreshFfmpeg(): Promise<void> {
		this.setState({ ffmpegProbePending: true });
		try {
			const r = await bunRpc.getFfmpegProbe({});
			this.setState({
				ffmpegOk: r.ok,
				ffmpegLine: r.ok ? (r.versionLine ?? "") : (r.error ?? "not found"),
				ffmpegProbePending: false,
			});
		} catch (err) {
			this.setState({
				ffmpegOk: false,
				ffmpegLine: (err as Error).message,
				ffmpegProbePending: false,
			});
		}
	}
}

function readDismissed(): boolean {
	try {
		return localStorage.getItem(DISMISS_KEY) === "1";
	} catch {
		return false;
	}
}

function chipClass(ok: boolean | null): string {
	if (ok === true) return "ok";
	if (ok === false) return "bad";
	return "";
}

function countAgents(): number {
	return Object.values(studio.state.participants).filter((p) => p.isAgent).length;
}

function escapeHtmlPlain(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}
