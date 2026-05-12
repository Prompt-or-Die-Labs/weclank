// Producer tray — hidden bottom panel over the stats / mixer. Never on the
// broadcast canvas; stays between the developer and the studio.
//
// Columns:
//   - Private studio chat: unified transcript (host mic STT when agents
//     listen, your [producer] lines, agent replies). Off-stream only.
//   - Actions: pending tool approvals + emote / cue grid.
//   - Run of show: segment list + timing.
//   - Tools: scene, music, record — plus compact audience intelligence.
//
// Toggle: backtick (`) outside text fields, or the bottom handle.

import { Component } from "../core/component";
import { studio } from "../state/studio-store";
import { banterEngine } from "../banter/banter-engine";
import type { AgentReply } from "../banter/banter-engine";
import { micTranscriber } from "../transcription/mic-transcriber";
import { agentActionQueue, type QueuedAgentAction } from "../banter/action-queue";
import {
	audienceIntelligence,
	type AudienceFlag,
	type AudienceQuestion,
	type AudienceSnapshot,
} from "../banter/audience-intelligence";
import { executeQueuedToolAction } from "../banter/tool-executor";
import { completedDurationSec, segmentTiming, totalDurationSec, type SegmentTiming } from "../producer/run-of-show";
import { streamOverlays } from "../streaming/stream-overlays";
import { localRecorder } from "../streaming/recorder";
import { audioMixer } from "../streaming/audio-mixer";
import { participantId as brand, mintId, overlayId, showSegmentId } from "../core/ids";
import type { ParticipantId } from "../core/ids";
import type { Participant, RunOfShowState, Scene, ShowSegment } from "../core/types";
import { toast } from "./overlays";
import { escapeHtml } from "./primitives";
import { userMessageFor } from "../core/errors";

const STORAGE_KEY = "studio.producerTray.open";
const CHAT_FEED_CAP = 100;

interface EmoteDef {
	id: string;
	label: string;
	subtitle: string;
	action: (agentId: ParticipantId | null) => void;
}

interface StudioChatRowHost {
	kind: "host";
	text: string;
	ts: number;
}
interface StudioChatRowProducer {
	kind: "producer";
	text: string;
	ts: number;
	targetLabel: string;
}
interface StudioChatRowAgent {
	kind: "agent";
	agentName: string;
	text: string;
	ts: number;
}

type StudioChatRow = StudioChatRowHost | StudioChatRowProducer | StudioChatRowAgent;

interface State {
	open: boolean;
	agents: Participant[];
	scenes: Scene[];
	activeSceneId: string;
	musicVolume: number;
	recording: boolean;
	targetAgentId: string;
	/** Off-stream transcript: mic, producer notes, agent replies. */
	studioChat: StudioChatRow[];
	hostMicForAgents: boolean;
	pendingActions: QueuedAgentAction[];
	audience: AudienceSnapshot;
	runOfShow: RunOfShowState;
	now: number;
}

export class ProducerTray extends Component<State> {
	private textarea: HTMLTextAreaElement | null = null;
	private unsubReplies: (() => void) | null = null;
	private unsubActions: (() => void) | null = null;
	private unsubAudience: (() => void) | null = null;
	private unsubHostMic: (() => void) | null = null;
	private unsubLifecycle: (() => void) | null = null;
	private timer: number | null = null;

	constructor() {
		const stored = (typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY)) === "1";
		const agents = collectAgents(studio.state.participants);
		const hostMicForAgents = computeHostMicForAgents();
		super({
			open: stored,
			agents,
			scenes: studio.state.scenes,
			activeSceneId: studio.state.activeSceneId,
			musicVolume: studio.state.music.volume,
			recording: studio.state.stream.recording,
			targetAgentId: agents[0]?.id ?? "",
			studioChat: [],
			hostMicForAgents,
			pendingActions: agentActionQueue.pending(),
			audience: audienceIntelligence.snapshot(),
			runOfShow: studio.state.runOfShow,
			now: Date.now(),
		});
		studio.select(
			(s) => s.participants,
			(participants) => {
				const next = collectAgents(participants);
				const hostMicForAgents = computeHostMicForAgents();
				this.setState({
					agents: next,
					targetAgentId: next.some((a) => a.id === this.state.targetAgentId)
						? this.state.targetAgentId
						: next[0]?.id ?? "",
					hostMicForAgents,
				});
				queueMicrotask(() => this.refreshStudioMicTap(hostMicForAgents));
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
		studio.select(
			(s) => s.runOfShow,
			(runOfShow) => this.setState({ runOfShow }),
		);
	}

	protected rootClass(): string {
		return "producer-tray";
	}

	protected template(): string {
		return `
			<button class="producer-tray__handle" data-action="toggle" aria-expanded="${this.state.open ? "true" : "false"}" aria-label="${this.state.open ? "Close private studio tray" : "Open private studio tray"}">
				<span class="producer-tray__handle-grip"></span>
				<span class="producer-tray__handle-label">${this.state.open ? "▾ HIDE" : "▴ STUDIO"}</span>
				<span class="producer-tray__handle-hint">\`</span>
			</button>
			<div class="producer-tray__panel ${this.state.open ? "is-open" : ""}" aria-hidden="${this.state.open ? "false" : "true"}">
				<div class="producer-tray__col producer-tray__col--studio-chat">
					<div class="producer-tray__col-head producer-tray__col-head--stacked">
						<div class="producer-tray__chat-head-text">
							<span class="section-header">Private studio chat</span>
							<p class="producer-tray__chat-intro">
								Not on stream. Host mic lines appear here when an agent’s banter is running with <strong>Listen to my mic</strong> — same text the co-host hears.
							</p>
						</div>
						${this.renderTargetSelect()}
					</div>
					<div class="producer-tray__mic-status" role="status">${this.renderMicStatus()}</div>
					<div
						class="producer-tray__reply-feed"
						data-ref="chat-feed"
						role="log"
						aria-relevant="additions"
						aria-live="polite"
						aria-label="Private studio chat transcript"
					>
						${this.renderStudioChatFeed()}
					</div>
					<label class="producer-tray__visually-hidden" for="producer-tray-private-msg">Private message to agent</label>
					<textarea
						id="producer-tray-private-msg"
						class="producer-tray__textarea"
						data-field="message"
						placeholder="Private note to the selected agent — they reply on stream. ⌘↵ or Ctrl+↵ to send."
						rows="3"
					></textarea>
					<div class="producer-tray__send-row">
						<span class="producer-tray__hint">Hidden from viewers · audible agent reply</span>
						<button type="button" class="producer-tray__send" data-action="send">Send</button>
					</div>
				</div>

				<div class="producer-tray__col producer-tray__col--emotes">
					<div class="producer-tray__col-head">
						<span class="section-header">Actions</span>
					</div>
					${this.renderPendingActions()}
					<div class="producer-tray__emotes">
						${EMOTES.map((e) => `
							<button class="producer-tray__emote" data-emote="${e.id}" title="${escapeHtml(e.subtitle)}">
								<span class="producer-tray__emote-label">${escapeHtml(e.label)}</span>
								<span class="producer-tray__emote-sub">${escapeHtml(e.subtitle)}</span>
							</button>
						`).join("")}
					</div>
				</div>

				<div class="producer-tray__col producer-tray__col--run">
					<div class="producer-tray__col-head">
						<span class="section-header">Run</span>
						<div class="producer-tray__run-actions">
							<button type="button" data-action="run-next">Next</button>
							<button type="button" data-action="run-add">Add</button>
						</div>
					</div>
					${this.renderRunOfShow()}
				</div>

				<div class="producer-tray__col producer-tray__col--tools">
					<div class="producer-tray__col-head">
						<span class="section-header">Tools</span>
					</div>

					${this.renderAudienceIntelligence()}

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
						<button class="producer-tray__tool-btn ${this.state.recording ? "is-on" : ""}" data-action="record">${this.state.recording ? "■ STOP" : "○ REC"}</button>
						<button class="producer-tray__tool-btn" data-action="panic">Panic mute</button>
					</div>
				</div>
			</div>
		`;
	}

	private renderPendingActions(): string {
		const actions = this.state.pendingActions.slice(0, 3);
		if (actions.length === 0) {
			return '<div class="producer-tray__suggestions-empty">No AI actions waiting</div>';
		}
		return `
			<div class="producer-tray__suggestions">
				${actions.map((action) => `
					<article class="producer-tray__suggestion producer-tray__suggestion--${action.risk}" data-action-id="${escapeHtml(action.id)}">
						<div class="producer-tray__suggestion-main">
							<span class="producer-tray__suggestion-agent">${escapeHtml(action.agentName)}</span>
							<span class="producer-tray__suggestion-title">${escapeHtml(actionTitle(action))}</span>
							<span class="producer-tray__suggestion-reason">${escapeHtml(action.reason)}</span>
						</div>
						<div class="producer-tray__suggestion-actions">
							<button type="button" data-approve="${escapeHtml(action.id)}">Approve</button>
							<button type="button" data-reject="${escapeHtml(action.id)}">Reject</button>
						</div>
					</article>
				`).join("")}
			</div>
		`;
	}

	private renderTargetSelect(): string {
		if (this.state.agents.length === 0) {
			return '<span class="producer-tray__no-agents">No agents</span>';
		}
		return `
			<select class="producer-tray__target" data-field="target" aria-label="Agent to message">
				${this.state.agents.map((a) => `<option value="${escapeHtml(a.id)}"${a.id === this.state.targetAgentId ? " selected" : ""}>${escapeHtml(a.displayName)}</option>`).join("")}
			</select>
		`;
	}

	private renderMicStatus(): string {
		if (!this.state.hostMicForAgents) {
			return `<span class="producer-tray__mic-status-line producer-tray__mic-status-line--idle">Host mic → agents: <strong>idle</strong>. Start banter with <strong>Listen to my mic</strong> and use a mic or camera-with-audio source.</span>`;
		}
		const stats = micTranscriber.getStats();
		const cap = micTranscriber.isRunning ? "capturing" : "waiting for audio source";
		return `<span class="producer-tray__mic-status-line"><strong>Host mic → agents:</strong> ${escapeHtml(cap)} · ${escapeHtml(stats.model)}</span>`;
	}

	private renderStudioChatFeed(): string {
		if (this.state.studioChat.length === 0) {
			return '<div class="producer-tray__reply-empty">Mic lines, your notes, and agent replies gather here.</div>';
		}
		return this.state.studioChat
			.map((row) => {
				const t = formatChatTime(row.ts);
				if (row.kind === "host") {
					return `<div class="producer-tray__chat-row producer-tray__chat-row--host"><span class="producer-tray__chat-meta">${escapeHtml(t)}</span><span class="producer-tray__chat-label">You (mic)</span><span class="producer-tray__chat-body">${escapeHtml(row.text)}</span></div>`;
				}
				if (row.kind === "producer") {
					return `<div class="producer-tray__chat-row producer-tray__chat-row--producer"><span class="producer-tray__chat-meta">${escapeHtml(t)}</span><span class="producer-tray__chat-label">You → ${escapeHtml(row.targetLabel)}</span><span class="producer-tray__chat-body">${escapeHtml(row.text)}</span></div>`;
				}
				return `<div class="producer-tray__chat-row producer-tray__chat-row--agent"><span class="producer-tray__chat-meta">${escapeHtml(t)}</span><span class="producer-tray__chat-label">${escapeHtml(row.agentName)}</span><span class="producer-tray__chat-body">${escapeHtml(row.text)}</span></div>`;
			})
			.join("");
	}

	private renderAudienceIntelligence(): string {
		const topQuestion = this.state.audience.questions[0] ?? null;
		const topFlag = this.state.audience.flags[0] ?? null;
		return `
			<div class="producer-tray__audience">
				<div class="producer-tray__audience-stats" aria-label="Audience intelligence">
					<span class="producer-tray__audience-stat">
						<strong>${this.state.audience.chatVelocity}</strong>
						<em>/min</em>
					</span>
					<span class="producer-tray__audience-stat producer-tray__audience-stat--${this.state.audience.sentiment.label}">
						<strong>${escapeHtml(this.state.audience.sentiment.label)}</strong>
						<em>mood</em>
					</span>
					<span class="producer-tray__audience-stat">
						<strong>${this.state.audience.questions.length}</strong>
						<em>Q</em>
					</span>
					<span class="producer-tray__audience-stat">
						<strong>${this.state.audience.flags.length}</strong>
						<em>flags</em>
					</span>
				</div>
				${topQuestion ? this.renderQuestion(topQuestion) : '<div class="producer-tray__audience-empty">No questions yet</div>'}
				${topFlag ? this.renderFlag(topFlag) : ""}
			</div>
		`;
	}

	private renderQuestion(question: AudienceQuestion): string {
		return `
			<article class="producer-tray__audience-item">
				<div class="producer-tray__audience-item-head">
					<span>Q - ${escapeHtml(question.author)}</span>
					<button type="button" data-question-cue="${escapeHtml(question.id)}">Cue answer</button>
				</div>
				<p>${escapeHtml(question.text)}</p>
			</article>
		`;
	}

	private renderFlag(flag: AudienceFlag): string {
		return `
			<article class="producer-tray__audience-item producer-tray__audience-item--flag producer-tray__audience-item--${flag.severity}">
				<div class="producer-tray__audience-item-head">
					<span>${escapeHtml(flag.kind)} - ${escapeHtml(flag.author)}</span>
					<button type="button" data-flag-cue="${escapeHtml(flag.id)}">Review</button>
				</div>
				<p>${escapeHtml(flag.reason)}: ${escapeHtml(flag.text)}</p>
			</article>
		`;
	}

	private renderRunOfShow(): string {
		const total = totalDurationSec(this.state.runOfShow);
		const completed = completedDurationSec(this.state.runOfShow);
		const active = this.activeSegment();
		return `
			<div class="producer-tray__run-summary">
				<span>${escapeHtml(active ? active.title : "Ready")}</span>
				<strong>${formatDuration(completed)} / ${formatDuration(total)}</strong>
			</div>
			<div class="producer-tray__run-list">
				${this.state.runOfShow.segments.length === 0
					? '<div class="producer-tray__run-empty">No segments</div>'
					: this.state.runOfShow.segments.map((segment) => this.renderRunSegment(segment)).join("")}
			</div>
		`;
	}

	private renderRunSegment(segment: ShowSegment): string {
		const timing = segmentTiming(segment, this.state.now);
		const minutes = Math.round(segment.durationSec / 60);
		const isLive = segment.status === "live";
		return `
			<article class="producer-tray__run-segment producer-tray__run-segment--${segment.status}">
				<div class="producer-tray__run-segment-top">
					<span class="producer-tray__run-status">${escapeHtml(segment.status)}</span>
					<input type="text" value="${escapeHtml(segment.title)}" data-run-title="${escapeHtml(segment.id)}" aria-label="Segment title" />
					<input type="number" min="1" max="240" value="${minutes}" data-run-duration="${escapeHtml(segment.id)}" aria-label="Segment duration in minutes" />
				</div>
				<div class="producer-tray__run-progress">
					<span style="width: ${Math.round(timing.progress * 100)}%"></span>
				</div>
				<div class="producer-tray__run-segment-bottom">
					<span class="producer-tray__run-time">${isLive ? formatSegmentClock(timing) : formatDuration(segment.durationSec)}</span>
					<div class="producer-tray__run-buttons">
						<button type="button" data-run-start="${escapeHtml(segment.id)}">${isLive ? "Live" : "Start"}</button>
						<button type="button" data-run-done="${escapeHtml(segment.id)}">Done</button>
						<button type="button" data-run-cue="${escapeHtml(segment.id)}">Cue</button>
						<button type="button" data-run-delete="${escapeHtml(segment.id)}">Del</button>
					</div>
				</div>
			</article>
		`;
	}

	protected afterMount(): void {
		this.bindToggle();
		this.bindForm();
		this.bindHotkey();
		this.unsubReplies = banterEngine.subscribeReplies((reply: AgentReply) => {
			const rows = [...this.state.studioChat, {
				kind: "agent" as const,
				agentName: reply.agentName,
				text: reply.text,
				ts: reply.timestamp,
			}].slice(-CHAT_FEED_CAP);
			this.setState({ studioChat: rows });
			requestAnimationFrame(() => this.scrollChatFeed());
		});
		this.unsubActions = agentActionQueue.subscribe((actions) => {
			this.setState({ pendingActions: actions.filter((action) => action.status === "pending") });
		});
		this.unsubAudience = audienceIntelligence.subscribe((audience) => {
			this.setState({ audience });
		});
		this.timer = window.setInterval(() => this.setState({ now: Date.now() }), 1000);
		this.refreshStudioMicTap(this.state.hostMicForAgents);
		this.unsubLifecycle = banterEngine.onSessionLifecycle(() => {
			const hostMicForAgents = computeHostMicForAgents();
			this.setState({ hostMicForAgents });
			this.refreshStudioMicTap(hostMicForAgents);
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
		this.unsubActions?.();
		this.unsubAudience?.();
		this.unsubHostMic?.();
		this.unsubHostMic = null;
		this.unsubLifecycle?.();
		this.unsubLifecycle = null;
		if (this.timer !== null) window.clearInterval(this.timer);
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

		const target = this.el.querySelector<HTMLSelectElement>('[data-field="target"]');
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

		for (const btn of this.$$<HTMLButtonElement>("[data-approve]")) {
			const id = btn.dataset["approve"];
			if (id) this.on(btn, "click", () => void this.approveAction(id));
		}
		for (const btn of this.$$<HTMLButtonElement>("[data-reject]")) {
			const id = btn.dataset["reject"];
			if (id) this.on(btn, "click", () => this.rejectAction(id));
		}
		for (const btn of this.$$<HTMLButtonElement>("[data-question-cue]")) {
			const id = btn.dataset["questionCue"];
			if (id) this.on(btn, "click", () => this.cueQuestion(id));
		}
		for (const btn of this.$$<HTMLButtonElement>("[data-flag-cue]")) {
			const id = btn.dataset["flagCue"];
			if (id) this.on(btn, "click", () => this.cueFlag(id));
		}
		const runNext = this.el.querySelector<HTMLButtonElement>('[data-action="run-next"]');
		if (runNext) this.on(runNext, "click", () => studio.advanceRunSegment());

		const runAdd = this.el.querySelector<HTMLButtonElement>('[data-action="run-add"]');
		if (runAdd) this.on(runAdd, "click", () => studio.addRunSegment());

		for (const input of this.$$<HTMLInputElement>("[data-run-title]")) {
			const id = input.dataset["runTitle"];
			if (id) this.on(input, "change", () => studio.updateRunSegment(showSegmentId(id), { title: input.value }));
		}
		for (const input of this.$$<HTMLInputElement>("[data-run-duration]")) {
			const id = input.dataset["runDuration"];
			if (id) this.on(input, "change", () => studio.updateRunSegment(showSegmentId(id), { durationSec: minutesToSeconds(input.value) }));
		}
		for (const btn of this.$$<HTMLButtonElement>("[data-run-start]")) {
			const id = btn.dataset["runStart"];
			if (id) this.on(btn, "click", () => studio.startRunSegment(showSegmentId(id)));
		}
		for (const btn of this.$$<HTMLButtonElement>("[data-run-done]")) {
			const id = btn.dataset["runDone"];
			if (id) this.on(btn, "click", () => studio.completeRunSegment(showSegmentId(id)));
		}
		for (const btn of this.$$<HTMLButtonElement>("[data-run-cue]")) {
			const id = btn.dataset["runCue"];
			if (id) this.on(btn, "click", () => this.cueSegment(showSegmentId(id)));
		}
		for (const btn of this.$$<HTMLButtonElement>("[data-run-delete]")) {
			const id = btn.dataset["runDelete"];
			if (id) this.on(btn, "click", () => studio.deleteRunSegment(showSegmentId(id)));
		}
	}

	private scrollChatFeed(): void {
		const feed = this.$<HTMLElement>('[data-ref="chat-feed"]');
		if (feed) feed.scrollTop = feed.scrollHeight;
	}

	/** Mirror host STT into the private chat when any running agent uses mic context. */
	private refreshStudioMicTap(want: boolean): void {
		if (want && !this.unsubHostMic) {
			this.unsubHostMic = micTranscriber.subscribe((text) => {
				const rows = [...this.state.studioChat, { kind: "host" as const, text, ts: Date.now() }].slice(-CHAT_FEED_CAP);
				this.setState({ studioChat: rows });
				requestAnimationFrame(() => this.scrollChatFeed());
			});
		} else if (!want && this.unsubHostMic) {
			this.unsubHostMic();
			this.unsubHostMic = null;
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
		const agent = this.state.agents.find((a) => a.id === this.state.targetAgentId);
		const targetLabel = agent?.displayName ?? "Agent";
		const rows = [...this.state.studioChat, {
			kind: "producer" as const,
			text,
			ts: Date.now(),
			targetLabel,
		}].slice(-CHAT_FEED_CAP);
		this.setState({ studioChat: rows });
		banterEngine.injectFor(target, {
			author: "[producer]",
			text,
			timestamp: Date.now(),
			meta: { source: "producer-tray" },
		});
		this.textarea.value = "";
		requestAnimationFrame(() => this.scrollChatFeed());
	}

	private async toggleRecord(): Promise<void> {
		const recording = studio.state.stream.recording || localRecorder.isRecording;
		if (recording) {
			localRecorder.stop();
			return;
		}
		try {
			await localRecorder.start();
			toast("Recording", "success");
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

	private async approveAction(id: string): Promise<void> {
		try {
			await executeQueuedToolAction(id);
			toast("AI action approved", "success");
		} catch (err) {
			toast(`AI action failed: ${userMessageFor(err)}`, "error");
		}
	}

	private rejectAction(id: string): void {
		agentActionQueue.reject(id);
		toast("AI action rejected", "info");
	}

	private cueQuestion(id: string): void {
		const question = audienceIntelligence.findQuestion(id);
		if (!question) return;
		this.injectProducerCue(`Viewer ${question.author} asked: "${question.text}". Give the host a concise answer they can say live, and flag uncertainty if source checking is needed.`);
	}

	private cueFlag(id: string): void {
		const flag = audienceIntelligence.findFlag(id);
		if (!flag) return;
		this.injectProducerCue(`Moderation alert for ${flag.author}: "${flag.text}". Recommend one calm action for the host or moderator. Reason: ${flag.reason}.`);
	}

	private cueSegment(id: ShowSegment["id"]): void {
		const segment = this.state.runOfShow.segments.find((entry) => entry.id === id);
		if (!segment) return;
		this.injectProducerCue(`The run-of-show segment is "${segment.title}" for ${formatDuration(segment.durationSec)}. Help the host transition into this segment in one concise line.`);
	}

	private injectProducerCue(text: string): void {
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
		banterEngine.injectFor(target, producerCue(text));
		toast("Producer cue sent", "info");
	}

	private activeSegment(): ShowSegment | null {
		return this.state.runOfShow.segments.find((segment) => segment.id === this.state.runOfShow.activeSegmentId) ?? null;
	}
}

function collectAgents(participants: Record<string, Participant>): Participant[] {
	return Object.values(participants).filter((p) => p.isAgent);
}

function computeHostMicForAgents(): boolean {
	for (const p of Object.values(studio.state.participants)) {
		if (!p.isAgent || !p.banter) continue;
		if (p.banter.enabled === false) continue;
		if (p.banter.voiceContext === false) continue;
		if (!banterEngine.isRunning(p.id)) continue;
		return true;
	}
	return false;
}

function formatChatTime(ts: number): string {
	try {
		return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
	} catch {
		return "";
	}
}

function actionTitle(action: QueuedAgentAction): string {
	switch (action.invocation.name) {
		case "show_overlay":
			return `Show ${action.invocation.args.kind}${action.invocation.args.title ? `: ${action.invocation.args.title}` : ""}`;
		case "remove_overlay":
			return `Remove overlay ${action.invocation.args.id}`;
		case "list_overlays":
			return "Read active overlays";
		case "play_music":
			return `Play music: ${action.invocation.args.prompt}`;
		case "stop_music":
			return "Stop music";
		case "set_music_volume":
			return `Set music volume to ${Math.round(action.invocation.args.volume * 100)}%`;
		case "generate_broadcast_image":
			return `Generate image: ${action.invocation.args.prompt.slice(0, 80)}${action.invocation.args.prompt.length > 80 ? "…" : ""}`;
		default: {
			const inv = action.invocation as { name: string };
			return inv.name;
		}
	}
}

function minutesToSeconds(raw: string): number {
	const minutes = Number(raw);
	if (!Number.isFinite(minutes)) return 300;
	return Math.round(minutes * 60);
}

function formatDuration(seconds: number): string {
	const totalMinutes = Math.max(0, Math.round(seconds / 60));
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatSegmentClock(timing: SegmentTiming): string {
	return timing.overrun ? `+${formatClock(timing.overrunSec)}` : formatClock(timing.remainingSec);
}

function formatClock(seconds: number): string {
	const minutes = Math.floor(seconds / 60);
	const remainder = seconds % 60;
	return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
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
