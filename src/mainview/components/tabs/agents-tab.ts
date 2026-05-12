// Agents tab — the product's distinctive surface. Lists every AI co-host
// participant with:
//   - phase chip from the banter session state machine
//     (idle → listening → thinking → generating → speaking)
//   - speaking-ring driven by analyser amplitude (always-on visual)
//   - banter on/off toggle
//   - "Speak…" button (manual TTS test)
//   - Voice / Banter settings entry points
//   - rolling tool-call log (last few entries with timestamp + outcome)

import { Component } from "../../core/component";
import { studio } from "../../state/studio-store";
import type { Participant, SourceKind } from "../../core/types";
import { audioMixer } from "../../streaming/audio-mixer";
import { banterEngine, type BanterPhase, type ToolCallRecord } from "../../banter/banter-engine";
import { runtimeAutonomy, runtimeToolPermissions } from "../../banter/tool-policy";
import { pickBanterConfig } from "../../banter/config-dialog";
import { pickTTSConfig } from "../../tts/config-dialog";
import { initVoiceRoute, speakWithVoiceRoute } from "../../tts/voice-route";
import { createParticipantFromKind } from "../../state/source-factory";
import { pickAssistantConfig, ASSISTANT_ROLES } from "../../banter/assistant-config-dialog";
import { Popover, toast } from "../overlays";
import { userMessageFor } from "../../core/errors";
import { escapeHtml } from "../primitives";

interface State {
	agents: Participant[];
}

const SCRATCH = new Uint8Array(new ArrayBuffer(1024));

const PHASE_LABELS: Record<BanterPhase, string> = {
	idle: "Idle",
	listening: "Listening",
	thinking: "Thinking",
	generating: "Generating",
	speaking: "Speaking",
};

export class AgentsTab extends Component<State> {
	private raf = 0;

	constructor() {
		super({ agents: collectAgents(studio.state.participants) });
		studio.select(
			(s) => s.participants,
			(participants) => this.setState({ agents: collectAgents(participants) }),
		);
	}

	protected rootClass(): string {
		return "tab tab-agents";
	}

	protected template(): string {
		const addBtn = `<button class="tab-agents__add" data-action="add">+ Add co-host</button>`;
		if (this.state.agents.length === 0) {
			return `
				<div class="tab-agents__empty-state">
					<p class="tab-agents__empty-text">No AI co-hosts yet.</p>
					${addBtn}
				</div>
			`;
		}
		return `
			<div class="tab-agents__header">
				<span class="tab-agents__count">${this.state.agents.length} agent${this.state.agents.length !== 1 ? "s" : ""}</span>
				${addBtn}
			</div>
			<div class="tab-agents__list">
				${this.state.agents.map((a) => this.renderAgent(a)).join("")}
			</div>
		`;
	}

	private renderAgent(p: Participant): string {
		const isText = p.kind === "text";
		const banterOn = banterEngine.isRunning(p.id);
		const enginePhase: BanterPhase = banterOn ? banterEngine.getPhase(p.id) : "idle";
		const speakingByAmp = !banterOn && !isText && readAmp(p.id) > 0.06;
		const phase: BanterPhase = speakingByAmp ? "speaking" : enginePhase;
		const phaseLabel = banterOn ? PHASE_LABELS[phase] : (speakingByAmp ? "Speaking" : "Off");

		const roleName = isText
			? (ASSISTANT_ROLES.find((r) => r.id === p.assistantRole)?.label ?? "Assistant")
			: null;
		const subline = isText
			? (p.banter?.twitchChannel ? `Watching #${escapeHtml(p.banter.twitchChannel)}` : "Text only")
			: p.banter?.twitchChannel
				? `Watching #${escapeHtml(p.banter.twitchChannel)}`
				: p.banter?.proactiveOnTranscript
					? "Proactive on transcript"
					: "Manual mode";
		const policyLine = p.banter ? policySummary(p.banter) : "No agent policy";

		const log = banterOn ? banterEngine.getToolCallLog(p.id).slice(-3).reverse() : [];
		return `
			<article class="agent-card${isText ? " agent-card--text" : ""}" data-pid="${escapeHtml(p.id)}">
				<header class="agent-card__head">
					<div class="agent-card__avatar${isText ? " agent-card__avatar--text" : ""}" ${isText ? "" : "data-ring"}>
						<span class="agent-card__initial">${escapeHtml(p.displayName.charAt(0).toUpperCase())}</span>
					</div>
					<div class="agent-card__title">
						<div class="agent-card__name">
							${escapeHtml(p.displayName)}
							${roleName ? `<span class="agent-card__role-badge">${escapeHtml(roleName)}</span>` : ""}
						</div>
						<div class="agent-card__sub">${escapeHtml(subline)}</div>
						<div class="agent-card__policy">${escapeHtml(policyLine)}</div>
					</div>
					<span class="agent-card__chip agent-card__chip--${banterOn ? phase : "off"}">${phaseLabel}</span>
				</header>
				${log.length > 0 ? this.renderLog(log) : ""}
				<footer class="agent-card__actions">
					${isText ? `<button class="agent-card__btn" data-act="edit">Edit</button>` : `
					<button class="agent-card__btn" data-act="speak">Speak…</button>
					<button class="agent-card__btn" data-act="voice">Voice</button>
					`}
					<button class="agent-card__btn" data-act="banter">${banterOn ? "Stop" : "Start"}</button>
				</footer>
			</article>
		`;
	}

	private renderLog(entries: ToolCallRecord[]): string {
		return `
			<div class="agent-card__log">
				${entries.map((e) => {
					const time = formatRelative(e.ts);
					const args = summarizeArgs(e.name, e.args);
					return `
						<div class="agent-card__log-row ${e.ok ? "" : "is-error"}">
							<span class="agent-card__log-time">${escapeHtml(time)}</span>
							<span class="agent-card__log-name">${escapeHtml(e.name)}</span>
							${args ? `<span class="agent-card__log-args">${escapeHtml(args)}</span>` : ""}
						</div>
					`;
				}).join("")}
			</div>
		`;
	}

	protected bind(): void {
		const addBtn = this.$<HTMLButtonElement>("[data-action='add']");
		if (addBtn) this.on(addBtn, "click", (e) => this.openAddMenu(e.currentTarget as HTMLElement));
		for (const card of this.$$<HTMLElement>("[data-pid]")) {
			const pid = card.dataset["pid"];
			if (!pid) continue;
			const agent = this.state.agents.find((a) => a.id === pid);
			if (!agent) continue;
			card.querySelectorAll<HTMLButtonElement>("[data-act]").forEach((btn) => {
				this.on(btn, "click", () => this.onAction(agent, btn.dataset["act"]));
			});
		}
	}

	private openAddMenu(anchor: HTMLElement): void {
		const menu = document.createElement("div");
		menu.className = "menu";
		menu.innerHTML = `
			<div class="menu__section">Voice co-host</div>
			<button class="menu__item" data-kind="voice">Voice only</button>
			<button class="menu__item" data-kind="voice-image">Voice + image</button>
			<button class="menu__item" data-kind="voice-vrm">Voice + VRM avatar</button>
			<button class="menu__item" data-kind="voice-glb">Voice + GLB model</button>
			<div class="menu__section">Text assistant</div>
			<button class="menu__item" data-kind="text">Co-host · Monitor · Producer · Overlay bot…</button>
		`;
		const popover = new Popover({ anchor, content: menu, placement: "bottom" });
		menu.querySelectorAll<HTMLButtonElement>("[data-kind]").forEach((btn) => {
			btn.addEventListener("click", () => {
				popover.dismiss();
				const kind = btn.dataset["kind"] as SourceKind;
				void createParticipantFromKind(kind)
					.then((id) => { if (id) toast(`${kind === "text" ? "Text assistant" : "AI co-host"} added`, "success"); })
					.catch((err) => toast(`Failed to add agent: ${userMessageFor(err)}`, "error"));
			});
		});
	}

	protected afterMount(): void {
		this.startRing();
	}

	protected beforeDestroy(): void {
		cancelAnimationFrame(this.raf);
	}

	protected update(): void {
		super.update();
		this.startRing();
	}

	private startRing(): void {
		cancelAnimationFrame(this.raf);
		const loop = (): void => {
			this.tickRing();
			this.raf = requestAnimationFrame(loop);
		};
		this.raf = requestAnimationFrame(loop);
	}

	private tickRing(): void {
		for (const card of this.$$<HTMLElement>("[data-pid]")) {
			const pid = card.dataset["pid"];
			if (!pid) continue;
			const ring = card.querySelector<HTMLElement>("[data-ring]");
			if (!ring) continue;
			const amp = readAmp(pid);
			const intensity = Math.min(1, amp * 3);
			ring.style.boxShadow = intensity > 0.05
				? `0 0 0 ${1 + intensity * 3}px rgba(74, 222, 128, ${0.2 + intensity * 0.5})`
				: "none";

			// Refresh the phase chip in place — phase transitions happen
			// faster than chat events would naturally re-render the card.
			const chip = card.querySelector<HTMLElement>(".agent-card__chip");
			if (chip) {
				const branded = pid as Participant["id"];
				const banterOn = banterEngine.isRunning(branded);
				const enginePhase: BanterPhase = banterOn ? banterEngine.getPhase(branded) : "idle";
				const speakingByAmp = !banterOn && amp > 0.06;
				const phase: BanterPhase = speakingByAmp ? "speaking" : enginePhase;
				const phaseLabel = banterOn ? PHASE_LABELS[phase] : (speakingByAmp ? "Speaking" : "Off");
				const desiredClass = `agent-card__chip agent-card__chip--${banterOn ? phase : "off"}`;
				if (chip.className !== desiredClass) chip.className = desiredClass;
				if (chip.textContent !== phaseLabel) chip.textContent = phaseLabel;
			}
		}
	}

	private async onAction(agent: Participant, act: string | undefined): Promise<void> {
		switch (act) {
			case "speak":
				await this.speakManual(agent);
				break;
			case "voice":
				await this.editVoice(agent);
				break;
			case "edit":
				await this.editAssistant(agent);
				break;
			case "banter":
				await this.toggleBanter(agent);
				break;
		}
	}

	private async editAssistant(p: Participant): Promise<void> {
		const next = await pickAssistantConfig({
			displayName: p.displayName,
			role: p.assistantRole,
			banterConfig: p.banter,
		});
		if (!next) return;
		if (banterEngine.isRunning(p.id)) banterEngine.stop(p.id);
		studio.updateParticipant(p.id, {
			displayName: next.displayName,
			assistantRole: next.role,
			banter: next.banterConfig,
		});
		if (next.banterConfig.enabled) {
			const started = banterEngine.start(p.id, next.banterConfig);
			if (started.ok) toast(`${next.displayName} updated and running`, "success");
			else toast(`Agent chat failed: ${started.error ?? "Unknown error"}`, "error");
		} else {
			toast(`${next.displayName} updated`, "success");
		}
	}

	private async speakManual(p: Participant): Promise<void> {
		const text = window.prompt(`What should ${p.displayName} say?`, "Hello, viewers.");
		if (!text) return;
		try {
			await speakWithVoiceRoute(p.id, text);
		} catch (err) {
			toast(`TTS failed: ${userMessageFor(err)}`, "error");
		}
	}

	private async editVoice(p: Participant): Promise<void> {
		const next = await pickTTSConfig(p.tts);
		if (!next) return;
		try {
			initVoiceRoute(p.id, next);
			toast("Voice settings updated", "success");
		} catch (err) {
			toast(`Voice settings failed: ${userMessageFor(err)}`, "error");
		}
	}

	private async toggleBanter(p: Participant): Promise<void> {
		if (banterEngine.isRunning(p.id)) {
			banterEngine.stop(p.id);
			studio.updateParticipant(p.id, { banter: p.banter ? { ...p.banter, enabled: false } : undefined });
			toast("Banter stopped");
			return;
		}
		const next = await pickBanterConfig(p.banter);
		if (!next) return;
		studio.updateParticipant(p.id, { banter: next });
		if (next.enabled) {
			const started = banterEngine.start(p.id, next);
			if (started.ok) toast(`Banter running for ${p.displayName}`, "success");
			else toast(`Agent chat failed: ${started.error ?? "Unknown error"}`, "error");
		}
	}
}

function collectAgents(participants: Record<string, Participant>): Participant[] {
	return Object.values(participants).filter((p) => p.isAgent);
}

function policySummary(config: NonNullable<Participant["banter"]>): string {
	const permissions = runtimeToolPermissions(config);
	const enabled = [
		permissions.controlOverlays ? "overlays" : "",
		permissions.controlMusic ? "music" : "",
	].filter(Boolean).join("+") || "no tools";
	return `${runtimeAutonomy(config)} · ${enabled}`;
}

function readAmp(id: string): number {
	const analyser = audioMixer.getAnalyser(id);
	if (!analyser) return 0;
	const bins = Math.min(SCRATCH.length, analyser.frequencyBinCount);
	analyser.getByteFrequencyData(SCRATCH);
	let sum = 0;
	for (let i = 0; i < bins; i++) sum += SCRATCH[i] ?? 0;
	return sum / bins / 255;
}

/** "12s ago" / "3m ago" / "11:04" — short, glanceable. */
function formatRelative(ts: number): string {
	const diffSec = Math.floor((Date.now() - ts) / 1000);
	if (diffSec < 60) return `${Math.max(0, diffSec)}s`;
	if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
	const d = new Date(ts);
	const hh = d.getHours().toString().padStart(2, "0");
	const mm = d.getMinutes().toString().padStart(2, "0");
	return `${hh}:${mm}`;
}

/** Tool-call args → short readable summary for the log row. */
function summarizeArgs(name: string, args: Record<string, unknown>): string {
	switch (name) {
		case "show_overlay": {
			const title = typeof args["title"] === "string" ? args["title"] : "";
			const kind = typeof args["kind"] === "string" ? args["kind"] : "";
			return title ? `"${title}" (${kind})` : kind;
		}
		case "remove_overlay":
			return typeof args["id"] === "string" ? String(args["id"]) : "";
		case "play_music":
			return typeof args["prompt"] === "string" ? `"${args["prompt"]}"` : "";
		case "set_music_volume":
			return typeof args["volume"] === "number" ? `vol ${args["volume"]}` : "";
		default:
			return "";
	}
}
