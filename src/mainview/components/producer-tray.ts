// Producer tray — hidden bottom panel that slides up over the stats /
// mixer area. NEVER appears on the broadcast canvas (it's just DOM,
// not part of the StreamEngine compositor), so anything in here stays
// between the producer and the studio.
//
// Three zones:
//   - Direct Message:     textarea + target-agent selector. Sends as
//                         a `[producer]`-authored synthetic chat turn
//                         to the chosen agent via banterEngine.injectFor.
//                         Agent responds via TTS (audible on stream),
//                         but the trigger itself stays hidden.
//   - Emotes / Cues:      grid of pre-canned director actions —
//                         hype, greet, transition, BRB, calm, tease.
//                         Each one either injects a hidden prompt to
//                         the agent or fires a stream overlay / music
//                         action directly.
//   - Producer Tools:     scene quick-switch dropdown, music volume
//                         slider, record toggle, panic-mute. Things
//                         a producer reaches for that don't deserve
//                         their own first-class UI surface.
//
// Toggle: backtick (`) anywhere outside a text input. Also via the
// pinned handle at the bottom-center of the screen. State persists
// to localStorage per session so the tray re-opens on reload if it
// was open before.

import { Component } from "../core/component";
import { studio } from "../state/studio-store";
import { banterEngine } from "../banter/banter-engine";
import type { AgentReply } from "../banter/banter-engine";
import { streamOverlays } from "../streaming/stream-overlays";
import { localRecorder } from "../streaming/recorder";
import { audioMixer } from "../streaming/audio-mixer";
import { participantId as brand, mintId, overlayId } from "../core/ids";
import type { ParticipantId } from "../core/ids";
import type { Participant, Scene } from "../core/types";
import { toast } from "./overlays";
import { escapeHtml } from "./primitives";
import { userMessageFor } from "../core/errors";

const STORAGE_KEY = "studio.producerTray.open";
const HOST_ID = brand("host");

interface EmoteDef {
	id: string;
	label: string;
	subtitle: string;
	action: (agentId: ParticipantId | null) => void;
}

interface AgentReplyRow {
	agentName: string;
	text: string;
	timestamp: number;
}

interface State {
	open: boolean;
	agents: Participant[];
	scenes: Scene[];
	activeSceneId: string;
	musicVolume: number;
	recording: boolean;
	targetAgentId: string;
	agentReplies: AgentReplyRow[];
}

export class ProducerTray extends Component<State> {
	private textarea: HTMLTextAreaElement | null = null;
	private unsubReplies: (() => void) | null = null;

	constructor() {
		const stored = (typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY)) === "1";
		const agents = collectAgents(studio.state.participants);
		super({
			open: stored,
			agents,
			scenes: studio.state.scenes,
			activeSceneId: studio.state.activeSceneId,
			musicVolume: studio.state.music.volume,
			recording: studio.state.stream.recording,
			targetAgentId: agents[0]?.id ?? "",
			agentReplies: [],
		});
		studio.select(
			(s) => s.participants,
			(participants) => {
				const next = collectAgents(participants);
				this.setState({
					agents: next,
					targetAgentId: next.some((a) => a.id === this.state.targetAgentId)
						? this.state.targetAgentId
						: next[0]?.id ?? "",
				});
			},
		);
		studio.select(
			(s) => s.scenes,
			(scenes) => this.setState({ scenes }),
		);
		studio.select(
			(s) => s.activeSceneId,
			(activeSceneId) => this.setState({ activeSceneId }),
		);
		studio.select(
			(s) => s.music.volume,
			(musicVolume) => this.setState({ musicVolume }),
		);
		studio.select(
			(s) => s.stream.recording,
			(recording) => this.setState({ recording }),
		);
	}

	protected rootClass(): string {
		return "producer-tray";
	}

	protected template(): string {
		return `
			<button class="producer-tray__handle" data-action="toggle" aria-expanded="${this.state.open ? "true" : "false"}" aria-label="${this.state.open ? "Close producer tray (\`)" : "Open producer tray (\`)"}">
				<span class="producer-tray__handle-grip"></span>
				<span class="producer-tray__handle-label">${this.state.open ? "▾ HIDE" : "▴ PRODUCER"}</span>
				<span class="producer-tray__handle-hint">\`</span>
			</button>
			<div class="producer-tray__panel ${this.state.open ? "is-open" : ""}" aria-hidden="${this.state.open ? "false" : "true"}">
				<div class="producer-tray__col producer-tray__col--talk">
					<div class="producer-tray__col-head">
						<span class="section-header">Direct → Agent</span>
						${this.renderTargetSelect()}
					</div>
					<div class="producer-tray__reply-feed">
						${this.state.agentReplies.length === 0
							? '<div class="producer-tray__reply-empty">Agent responses appear here</div>'
							: this.state.agentReplies.map((r) => `
								<div class="producer-tray__reply-row">
									<span class="producer-tray__reply-name">${escapeHtml(r.agentName)}</span>
									<span class="producer-tray__reply-text">${escapeHtml(r.text)}</span>
								</div>
							`).join("")}
					</div>
					<textarea class="producer-tray__textarea" data-field="message" placeholder="Type a private note to the agent. They'll respond via voice. (⌘↵ to send)" rows="3"></textarea>
					<div class="producer-tray__send-row">
						<span class="producer-tray__hint">Audible response · trigger hidden</span>
						<button class="producer-tray__send" data-action="send">Send</button>
					</div>
				</div>

				<div class="producer-tray__col producer-tray__col--emotes">
					<div class="producer-tray__col-head">
						<span class="section-header">Cues</span>
					</div>
					<div class="producer-tray__emotes">
						${EMOTES.map((e) => `
							<button class="producer-tray__emote" data-emote="${e.id}" title="${escapeHtml(e.subtitle)}">
								<span class="producer-tray__emote-label">${escapeHtml(e.label)}</span>
								<span class="producer-tray__emote-sub">${escapeHtml(e.subtitle)}</span>
							</button>
						`).join("")}
					</div>
				</div>

				<div class="producer-tray__col producer-tray__col--tools">
					<div class="producer-tray__col-head">
						<span class="section-header">Tools</span>
					</div>

					<label class="producer-tray__tool-row">
						<span class="producer-tray__tool-label">Scene</span>
						<select data-field="scene">
							${this.state.scenes.map((s) => `<option value="${escapeHtml(s.id)}"${s.id === this.state.activeSceneId ? " selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}
						</select>
					</label>

					<label class="producer-tray__tool-row">
						<span class="producer-tray__tool-label">Music</span>
						<input type="range" min="0" max="100" value="${Math.round(this.state.musicVolume * 100)}" data-field="music" />
					</label>

					<div class="producer-tray__tool-buttons">
						<button class="producer-tray__tool-btn ${this.state.recording ? "is-on" : ""}" data-action="record">${this.state.recording ? "● Recording" : "○ Record"}</button>
						<button class="producer-tray__tool-btn" data-action="panic">Panic mute</button>
					</div>
				</div>
			</div>
		`;
	}

	private renderTargetSelect(): string {
		if (this.state.agents.length === 0) {
			return '<span class="producer-tray__no-agents">No agents</span>';
		}
		return `
			<select class="producer-tray__target" data-field="target">
				${this.state.agents.map((a) => `<option value="${escapeHtml(a.id)}"${a.id === this.state.targetAgentId ? " selected" : ""}>${escapeHtml(a.displayName)}</option>`).join("")}
			</select>
		`;
	}

	protected afterMount(): void {
		this.bindToggle();
		this.bindForm();
		this.bindHotkey();
		this.unsubReplies = banterEngine.subscribeReplies((reply: AgentReply) => {
			const rows = [...this.state.agentReplies, {
				agentName: reply.agentName,
				text: reply.text,
				timestamp: reply.timestamp,
			}].slice(-50);
			this.setState({ agentReplies: rows });
			// Keep feed scrolled to bottom.
			requestAnimationFrame(() => {
				const feed = this.$<HTMLElement>(".producer-tray__reply-feed");
				if (feed) feed.scrollTop = feed.scrollHeight;
			});
		});
	}

	protected update(): void {
		super.update();
		this.bindToggle();
		this.bindForm();
	}

	protected beforeDestroy(): void {
		window.removeEventListener("keydown", this.onWindowKey);
		this.unsubReplies?.();
	}

	private bindToggle(): void {
		const handle = this.$<HTMLButtonElement>('[data-action="toggle"]');
		if (handle) {
			this.on(handle, "click", () => this.toggle());
		}
	}

	private bindForm(): void {
		this.textarea = this.$<HTMLTextAreaElement>('[data-field="message"]');
		if (this.textarea) {
			this.on(this.textarea, "keydown", (e) => {
				const ke = e as KeyboardEvent;
				if ((ke.metaKey || ke.ctrlKey) && ke.key === "Enter") {
					ke.preventDefault();
					this.sendDirect();
				}
			});
		}
		const send = this.$<HTMLButtonElement>('[data-action="send"]');
		if (send) this.on(send, "click", () => this.sendDirect());

		const target = this.$<HTMLSelectElement>('[data-field="target"]');
		if (target) this.on(target, "change", () => this.setState({ targetAgentId: target.value }));

		const sceneSel = this.$<HTMLSelectElement>('[data-field="scene"]');
		if (sceneSel) {
			this.on(sceneSel, "change", () => studio.activateScene(sceneSel.value as Scene["id"]));
		}

		const musicSlider = this.$<HTMLInputElement>('[data-field="music"]');
		if (musicSlider) {
			this.on(musicSlider, "input", () => studio.setMusicVolume(Number(musicSlider.value) / 100));
		}

		const recBtn = this.$<HTMLButtonElement>('[data-action="record"]');
		if (recBtn) this.on(recBtn, "click", () => void this.toggleRecord());

		const panic = this.$<HTMLButtonElement>('[data-action="panic"]');
		if (panic) this.on(panic, "click", () => this.panicMute());

		for (const btn of this.$$<HTMLButtonElement>("[data-emote]")) {
			const id = btn.dataset["emote"];
			if (!id) continue;
			const def = EMOTES.find((e) => e.id === id);
			if (!def) continue;
			this.on(btn, "click", () => {
				const target = this.state.targetAgentId ? brand(this.state.targetAgentId) : null;
				def.action(target);
				toast(`Cue: ${def.label}`, "info");
			});
		}
	}

	private onWindowKey = (e: KeyboardEvent): void => {
		// Backtick toggles the tray. Skip when typing in any field —
		// otherwise the user can never type a `<code>` in chat.
		if (e.key !== "`") return;
		const t = e.target;
		if (t instanceof HTMLElement) {
			if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
		}
		e.preventDefault();
		this.toggle();
	};

	private bindHotkey(): void {
		window.addEventListener("keydown", this.onWindowKey);
	}

	private toggle(): void {
		const next = !this.state.open;
		this.setState({ open: next });
		try { localStorage.setItem(STORAGE_KEY, next ? "1" : "0"); } catch { /* unavailable */ }
		if (next) {
			// Defer focus to the next tick so the slide transition has
			// started; otherwise focus arrives before the panel is in view.
			setTimeout(() => this.textarea?.focus(), 50);
		}
	}

	private sendDirect(): void {
		if (!this.textarea) return;
		const text = this.textarea.value.trim();
		if (!text) return;
		if (!this.state.targetAgentId) {
			toast("No agent target — add an AI co-host first", "error");
			return;
		}
		const target = brand(this.state.targetAgentId);
		const session = banterEngine.isRunning(target);
		if (!session) {
			toast("Target agent's banter is off — start it from the Agents tab", "error");
			return;
		}
		banterEngine.injectFor(target, {
			author: "[producer]",
			text,
			timestamp: Date.now(),
			meta: { source: "producer-tray" },
		});
		this.textarea.value = "";
	}

	private async toggleRecord(): Promise<void> {
		try {
			if (localRecorder.isRecording) {
				const result = await localRecorder.stop();
				if (result.path) toast(`Saved to ${result.path}`, "success");
			} else {
				await localRecorder.start();
				toast("Recording", "success");
			}
		} catch (err) {
			toast(`Record toggle failed: ${userMessageFor(err)}`, "error");
		}
	}

	private panicMute(): void {
		// Hard-mute every channel in the mixer at once. Useful when an
		// agent goes haywire mid-stream.
		for (const id of audioMixer.channelIds()) {
			audioMixer.mute(id, true);
			const p = studio.state.participants[id];
			if (p) studio.updateParticipant(p.id, { muted: true });
		}
		toast("All channels muted", "info");
	}
}

function collectAgents(participants: Record<string, Participant>): Participant[] {
	return Object.values(participants).filter((p) => p.isAgent);
}

// --- Cue / emote definitions -------------------------------------------
//
// Each cue is either a hidden prompt injection (agent reacts in voice) or
// a direct overlay / music action. Adding more is a matter of dropping
// another entry into this array — the buttons render from it.

const EMOTES: EmoteDef[] = [
	{
		id: "greet",
		label: "GREET",
		subtitle: "Welcome the chat",
		action: (id) => {
			if (id) banterEngine.injectFor(id, producerCue("Welcome any new viewers warmly in one short sentence."));
		},
	},
	{
		id: "hype",
		label: "HYPE",
		subtitle: "Pump the energy",
		action: (id) => {
			if (id) banterEngine.injectFor(id, producerCue("React excitedly to what just happened on screen. Keep it under 8 words."));
		},
	},
	{
		id: "transition",
		label: "SEGUE",
		subtitle: "Move to next topic",
		action: (id) => {
			if (id) banterEngine.injectFor(id, producerCue("Wrap up the current beat and tease what's coming next."));
		},
	},
	{
		id: "tease",
		label: "TEASE",
		subtitle: "Hint at upcoming reveal",
		action: (id) => {
			if (id) banterEngine.injectFor(id, producerCue("Drop a one-line tease — something cool is coming up but don't say what."));
		},
	},
	{
		id: "calm",
		label: "CALM",
		subtitle: "Settle the agent down",
		action: (id) => {
			if (id) banterEngine.injectFor(id, producerCue("Take it down a notch. Be more thoughtful for the next few replies."));
		},
	},
	{
		id: "react",
		label: "REACT",
		subtitle: "Just react",
		action: (id) => {
			if (id) banterEngine.injectFor(id, producerCue("React to whatever just happened. One short line."));
		},
	},
	{
		id: "title",
		label: "TITLE",
		subtitle: "Drop a title card",
		action: () => {
			streamOverlays.add({
				id: mintId("ov", overlayId),
				kind: "title-card",
				props: { title: "Now Live", subtitle: studio.state.stream.title },
				position: "center",
				createdAt: Date.now(),
				expiresAt: Date.now() + 6000,
			});
		},
	},
	{
		id: "brb",
		label: "BRB",
		subtitle: "Be right back",
		action: () => {
			streamOverlays.add({
				id: mintId("ov", overlayId),
				kind: "title-card",
				props: { title: "BRB", subtitle: "Back in a moment." },
				position: "center",
				createdAt: Date.now(),
				expiresAt: Date.now() + 30_000,
			});
		},
	},
];

function producerCue(text: string): { author: string; text: string; timestamp: number; meta: Record<string, string> } {
	return {
		author: "[producer]",
		text,
		timestamp: Date.now(),
		meta: { source: "producer-cue" },
	};
}

// Avoid unused-import lint when HOST_ID isn't referenced elsewhere yet.
void HOST_ID;
