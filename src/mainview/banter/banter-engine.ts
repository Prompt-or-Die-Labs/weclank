// BanterEngine — runs one banter loop per agent participant.
//
// Loop: read chat → maybe respond → speak via the participant's TTS
// provider. Speaking flows through the existing audio pipeline so the
// speaking-ring + lip-sync + stream egress all light up without extra
// wiring.
//
// Guards:
//   - VAD gate: if a non-agent participant is talking, skip this turn.
//   - Cooldown: at most one reply per N seconds so the agent doesn't
//     monologue when chat is hyperactive.
//   - History trimming: keep the last ~10 turns in context, drop the rest.
//     Cheap LLM (Haiku) keeps cost negligible regardless.
//
// Observability surface for the Agents tab:
//   - `getPhase(id)` — current step in the per-session state machine
//     (idle → listening → thinking → generating → speaking → idle). The
//     UI maps these to status chips.
//   - `getToolCallLog(id)` — rolling buffer of the last 20 tool calls
//     so the user can see what the agent did and when. Captured by
//     instrumenting the executor call site inside runToolLoop.

import { anyHumanSpeaking } from "./vad";
import { LLMClient, type ChatTurn, type LLMResponse } from "./llm-client";
import type { ChatMessage } from "./chat-source";
import { chatBus } from "../chat/chat-bus";
import { BANTER_TOOLS } from "./tools";
import { executeToolCalls, type ToolCall, type ToolExecutionPolicy } from "./tool-executor";
import { runtimeAutonomy, runtimeToolPermissions } from "./tool-policy";
import { studio } from "../state/studio-store";
import { transcriptFeed } from "../transcript/feed";
import { micTranscriber } from "../transcription/mic-transcriber";
import { logger, metrics } from "../observability";
import { ensureVoiceRoute } from "../tts/registry";
import { userMessageFor } from "../core/errors";
import { setAiDegradedMessage } from "../studio-health";
import type { ParticipantId } from "../core/ids";
import type { BanterConfig } from "../core/types";

/** Where a session is in its respond cycle. Drives the Agents-tab chip. */
export type BanterPhase = "idle" | "listening" | "thinking" | "generating" | "speaking";

export interface BanterStartResult {
	ok: boolean;
	error?: string;
}

/** A text reply from an agent, emitted after the LLM responds and
 * before TTS speaks it. Consumed by the Chat tab + Producer tray. */
export interface AgentReply {
	participantId: ParticipantId;
	/** Display name of the agent at the time of the reply. */
	agentName: string;
	text: string;
	timestamp: number;
}

/** One entry in the rolling tool-call log. */
export interface ToolCallRecord {
	ts: number;
	name: string;
	args: Record<string, unknown>;
	ok: boolean;
	error?: string;
}

const TOOL_LOG_CAP = 20;

const COOLDOWN_MS = 6_000;
const MAX_HISTORY_TURNS = 20;
const MIN_MESSAGE_LENGTH = 3;
// Proactive idle trigger — how often we check and how long since the last
// utterance before we're allowed to chime in unprompted.
const IDLE_CHECK_INTERVAL_MS = 12_000;
const IDLE_QUIET_BEFORE_MS = 25_000;
/** Min interval between vision JPEG attachments to the LLM (per session). */
const VISION_PREVIEW_MIN_INTERVAL_MS = 15_000;

class BanterSession {
	private aborted = false;
	private chatUnsubscribe: (() => void) | null = null;
	private llm: LLMClient;
	private history: ChatTurn[] = [];
	private lastReplyAt = 0;
	private idleTimer: ReturnType<typeof setInterval> | null = null;
	private unsubscribeMic: (() => void) | null = null;
	/** AbortController whose signal threads through every in-flight LLM
	 * call. `stop()` aborts it so we don't keep tokens flying when the
	 * session has been told to shut down. Re-created in `run()`. */
	private abortController = new AbortController();
	/** High-water mark for transcript events this session has seen.
	 * Anything ≤ this won't trigger a proactive comment again. */
	private lastTranscriptSeq = 0;
	/** Last time we attached a program-preview frame for vision models. */
	private lastVisionPreviewAt = 0;
	/** Observable phase. Transitions in respond() / runToolLoop() /
	 * ensureProvider(). Read by the Agents tab via getPhase(). */
	phase: BanterPhase = "idle";
	/** Rolling buffer of recent tool calls — capped at TOOL_LOG_CAP. */
	toolLog: ToolCallRecord[] = [];
	/** Subscribers notified when a text reply is produced. */
	private replyListeners: Array<(reply: AgentReply) => void> = [];

	addReplyListener(fn: (reply: AgentReply) => void): () => void {
		this.replyListeners.push(fn);
		return () => { this.replyListeners = this.replyListeners.filter((l) => l !== fn); };
	}

	private emitReply(text: string): void {
		if (!text) return;
		const participant = studio.state.participants[this.participantId];
		const agentName = participant?.displayName ?? String(this.participantId);
		const reply: AgentReply = { participantId: this.participantId, agentName, text, timestamp: Date.now() };
		for (const fn of this.replyListeners) fn(reply);
	}

	constructor(
		private participantId: ParticipantId,
		private config: BanterConfig,
	) {
		this.llm = new LLMClient(config.llmModel, { provider: config.llmProvider ?? "openrouter" });
		// Default newer flags to true for configs persisted before they
		// existed — keeps backward compat without yet another migration.
		const patch: Partial<BanterConfig> = {};
		if (this.config.proactiveOnTranscript === undefined) patch.proactiveOnTranscript = true;
		if (this.config.voiceContext === undefined) patch.voiceContext = true;
		if (Object.keys(patch).length > 0) this.config = { ...this.config, ...patch };
	}

	async run(): Promise<void> {
		// Seed the high-water mark so the first idle check ignores any
		// pre-existing events.
		this.lastTranscriptSeq = transcriptFeed.currentMaxSeq();
		if (this.config.proactiveOnTranscript) {
			this.idleTimer = setInterval(() => void this.maybeProactiveComment(), IDLE_CHECK_INTERVAL_MS);
		}
		// Subscribe to the mic transcriber so the agent hears what the host
		// is saying. The transcriber stays running while at least one
		// session subscribes, then tears down when the last one unsubs.
		if (this.config.voiceContext) {
			micTranscriber.setTranscription({
				provider: this.config.transcriptionProvider ?? "openrouter",
				model: this.config.transcriptionModel,
			});
			this.unsubscribeMic = micTranscriber.subscribe((text) => this.onHostUtterance(text));
		}
		// Subscribe to the shared ChatBus rather than spinning up our own
		// connection. The bus is already running with whatever per-platform
		// channels the chat overlay config specifies, so every agent sees
		// every platform without duplicating sockets.
		this.chatUnsubscribe = chatBus.subscribe((msg) => {
			if (this.aborted) return;
			if (!this.shouldRespond(msg)) return;
			// Detach the response so one slow LLM call doesn't block other
			// messages from triggering their own respond pipelines.
			void this.respond(msg);
		});
	}

	stop(): void {
		this.aborted = true;
		this.abortController.abort();
		this.phase = "idle";
		if (this.idleTimer) clearInterval(this.idleTimer);
		this.idleTimer = null;
		this.unsubscribeMic?.();
		this.unsubscribeMic = null;
		this.chatUnsubscribe?.();
		this.chatUnsubscribe = null;
	}

	/** Transcribed utterance from the host's mic — feed into the same
	 * respond pipeline as a chat message, but tagged so the agent knows
	 * it's the host speaking. */
	private onHostUtterance(text: string): void {
		if (this.aborted) return;
		const msg: ChatMessage = {
			author: "[host]",
			text,
			timestamp: Date.now(),
			meta: { source: "voice" },
		};
		if (this.shouldRespond(msg)) void this.respond(msg);
	}

	/** Feed in a synthetic message (from the local chat input panel) as if
	 * it came from Twitch. Subject to the same gates as a real one. */
	injectMessage(msg: ChatMessage): void {
		if (this.aborted) return;
		const directProducerCue = msg.meta?.["source"] === "producer-tray" || msg.meta?.["source"] === "producer-cue";
		if (!this.shouldRespond(msg, directProducerCue)) return;
		void this.respond(msg);
	}

	private shouldRespond(msg: ChatMessage, ignoreCooldown = false): boolean {
		if (msg.text.length < MIN_MESSAGE_LENGTH) return false;
		if (!ignoreCooldown && Date.now() - this.lastReplyAt < COOLDOWN_MS) return false;
		if (this.config.voiceActivityGate && anyHumanSpeaking()) return false;
		return true;
	}

	private historyForLlmWithOptionalVision(): ChatTurn[] {
		if (!this.config.visionProgramPreview) return this.history;
		const now = Date.now();
		if (now - this.lastVisionPreviewAt < VISION_PREVIEW_MIN_INTERVAL_MS) return this.history;

		let canvas: HTMLCanvasElement;
		try {
			// Lazy-load: `studio-store` imports `banterEngine`; eager-importing
			// `stream-engine` here would construct StreamEngine at module load
			// (canvas 2D) and break Bun tests.
			const { streamEngine } = require("../streaming/stream-engine") as typeof import("../streaming/stream-engine");
			canvas = streamEngine.canvasEl;
		} catch {
			return this.history;
		}
		if (!canvas?.width) return this.history;

		let dataUrl: string;
		try {
			dataUrl = canvas.toDataURL("image/jpeg", 0.5);
		} catch {
			return this.history;
		}
		if (!dataUrl.startsWith("data:image/jpeg")) return this.history;

		const last = this.history[this.history.length - 1];
		if (!last || last.role !== "user" || typeof last.content !== "string" || !last.content.trim()) {
			return this.history;
		}

		this.lastVisionPreviewAt = now;
		const text = last.content;
		const augmented: ChatTurn = {
			role: "user",
			content: [
				{
					type: "text",
					text: `${text}\n\n[Attached: live program preview — JPEG of the composited broadcast canvas.]`,
				},
				{ type: "image_url", image_url: { url: dataUrl, detail: "low" } },
			],
		};
		return [...this.history.slice(0, -1), augmented];
	}

	private async respond(msg: ChatMessage): Promise<void> {
		// Reserve the cooldown slot up front so concurrent triggers can't
		// double-fire while the LLM is still thinking.
		this.lastReplyAt = Date.now();

		this.phase = "listening";

		this.history.push({ role: "user", content: `${msg.author}: ${msg.text}` });
		this.trimHistory();

		try {
			setAiDegradedMessage(null);
			const transcriptContext = this.buildTranscriptContext();
			const systemContent = transcriptContext
				? `${this.config.systemPrompt}\n\n${transcriptContext}`
				: this.config.systemPrompt;
			this.phase = "thinking";
			const reply = await this.runToolLoop(systemContent, this.historyForLlmWithOptionalVision());
			if (this.aborted) { this.phase = "idle"; return; }
			if (!reply) { this.phase = "idle"; return; }
			if (this.config.voiceActivityGate && anyHumanSpeaking()) {
				// User started talking while LLM was thinking — drop this
				// reply rather than talking over them. Don't add to
				// history so the next message can retry.
				this.history.pop();
				this.phase = "idle";
				return;
			}
			this.history.push({ role: "assistant", content: reply });
			this.trimHistory();
			this.emitReply(reply);

			const participant = studio.state.participants[this.participantId];
			if (participant?.kind === "text") {
				this.phase = "idle";
				return;
			}
			const provider = this.ensureProvider();
			if (!provider) {
				metrics().incrementCounter("banter_no_provider_total", { participant: this.participantId });
				logger().withFields({ component: "banter", participant: this.participantId }).warn("no TTS provider — set voice settings");
				this.phase = "idle";
				return;
			}
			this.phase = "speaking";
			metrics().incrementCounter("banter_speak_total", { participant: this.participantId });
			await provider.speak(reply);
		} catch (err) {
			metrics().incrementCounter("banter_respond_failures_total", { participant: this.participantId });
			logger().withFields({ component: "banter", participant: this.participantId }).withError(err).warn("respond failed");
			setAiDegradedMessage(userMessageFor(err));
		} finally {
			this.phase = "idle";
		}
	}

	/** Run the LLM with tool-calling enabled. Loops up to 4 times: tool
	 * call → execute → feed results back → next turn. Returns the first
	 * speakable text response. Tool call traffic stays local to this
	 * invocation; only the final text reply lands in this.history so the
	 * persistent context doesn't bloat.
	 *
	 * The session's AbortController threads through every LLM call —
	 * `stop()` aborts mid-respond instead of letting tokens keep flying. */
	private async runToolLoop(systemContent: string, history: ChatTurn[]): Promise<string> {
		const participant = studio.state.participants[this.participantId];
		return runToolLoop({
			llm: this.llm,
			systemContent,
			history,
			signal: this.abortController.signal,
			policy: {
				participantId: this.participantId,
				agentName: participant?.displayName ?? String(this.participantId),
				autonomyLevel: runtimeAutonomy(this.config),
				permissions: runtimeToolPermissions(this.config),
			},
			onTextReady: () => { this.phase = "generating"; },
			onToolCall: (entry) => this.pushToolLog(entry),
		});
	}

	private pushToolLog(entry: ToolCallRecord): void {
		this.toolLog.push(entry);
		if (this.toolLog.length > TOOL_LOG_CAP) {
			this.toolLog = this.toolLog.slice(-TOOL_LOG_CAP);
		}
	}

	private buildTranscriptContext(): string {
		if (!transcriptFeed.isActive()) return "";
		const summaries = transcriptFeed.recentSummaries(8);
		if (summaries.length === 0) return "";
		return [
			"Live coding-assistant feed — what the dev's AI is doing right now:",
			...summaries,
			"Use this context to react to actual work (e.g. 'nice, you're refactoring the auth module') instead of generic banter. Don't recite the list back.",
		].join("\n");
	}

	/** Idle trigger: when chat is quiet, the dev isn't talking, and the
	 * coding feed has new activity since we last commented, drop in a
	 * short reaction so the stream doesn't feel dead. */
	private async maybeProactiveComment(): Promise<void> {
		if (this.aborted) return;
		if (!this.config.proactiveOnTranscript) return;
		if (!transcriptFeed.isActive()) return;
		if (Date.now() - this.lastReplyAt < IDLE_QUIET_BEFORE_MS) return;
		if (this.config.voiceActivityGate && anyHumanSpeaking()) return;
		const newSummaries = transcriptFeed.summariesSince(this.lastTranscriptSeq, 8);
		if (newSummaries.length === 0) return;

		// Reserve cooldown + advance the seq cursor before the LLM call so
		// concurrent ticks don't double-fire.
		this.lastReplyAt = Date.now();
		this.lastTranscriptSeq = transcriptFeed.currentMaxSeq();

		const systemContent = [
			this.config.systemPrompt,
			"",
			"The viewer chat has been quiet for a while, but your dev's coding assistant has been working. Here's what just happened:",
			...newSummaries,
			"",
			"Drop in ONE short conversational reaction (1 sentence, max 25 words). React like a co-host watching over their shoulder. Don't recite the list, don't start with 'I notice' or 'I see', don't address the dev by name.",
		].join("\n");

		try {
			setAiDegradedMessage(null);
			this.phase = "thinking";
			const reply = await this.runToolLoop(systemContent, this.history);
			if (this.aborted || !reply) { this.phase = "idle"; return; }
			this.history.push({ role: "assistant", content: reply });
			this.trimHistory();
			this.emitReply(reply);
			const participant = studio.state.participants[this.participantId];
			if (participant?.kind === "text") { this.phase = "idle"; return; }
			const provider = this.ensureProvider();
			if (!provider) { this.phase = "idle"; return; }
			this.phase = "speaking";
			await provider.speak(reply);
		} catch (err) {
			metrics().incrementCounter("banter_proactive_failures_total", { participant: this.participantId });
			logger().withFields({ component: "banter", participant: this.participantId }).withError(err).warn("proactive comment failed");
			setAiDegradedMessage(userMessageFor(err));
		} finally {
			this.phase = "idle";
		}
	}

	private trimHistory(): void {
		if (this.history.length > MAX_HISTORY_TURNS) {
			this.history = this.history.slice(-MAX_HISTORY_TURNS);
		}
	}

	/** Provider may be missing after a reload — persistence drops runtime
	 * fields, so we lazily build it from the participant's TTS config and
	 * wire it into the mixer the same way source-factory does at create
	 * time. */
	private ensureProvider(): ReturnType<typeof ensureVoiceRoute> {
		try {
			return ensureVoiceRoute(this.participantId);
		} catch (err) {
			metrics().incrementCounter("banter_tts_init_failures_total", { participant: this.participantId });
			logger().withFields({ component: "banter", participant: this.participantId }).withError(err).warn("lazy TTS init failed");
			return null;
		}
	}
}

class BanterEngine {
	private sessions = new Map<string, BanterSession>();
	private globalReplyListeners: Array<{ fn: (reply: AgentReply) => void; unsubs: Array<() => void> }> = [];
	private sessionLifecycleListeners = new Set<() => void>();

	/** Fires when a banter session starts or stops (participant rows may be unchanged). */
	onSessionLifecycle(fn: () => void): () => void {
		this.sessionLifecycleListeners.add(fn);
		return () => {
			this.sessionLifecycleListeners.delete(fn);
		};
	}

	private emitSessionLifecycle(): void {
		for (const fn of this.sessionLifecycleListeners) {
			try {
				fn();
			} catch (err) {
				logger().withField("component", "banter").withError(err).warn("session lifecycle listener failed");
			}
		}
	}

	start(id: ParticipantId, config: BanterConfig): BanterStartResult {
		this.stop(id);
		if (!config.enabled) return { ok: true };
		let session: BanterSession;
		try {
			session = new BanterSession(id, config);
		} catch (err) {
			return { ok: false, error: userMessageFor(err) };
		}
		this.sessions.set(id, session);
		// Wire all existing global subscribers into the new session.
		for (const entry of this.globalReplyListeners) {
			entry.unsubs.push(session.addReplyListener(entry.fn));
		}
		this.syncHostMicTranscriptionPolicy();
		void session.run();
		this.emitSessionLifecycle();
		return { ok: true };
	}

	stop(id: ParticipantId): void {
		this.sessions.get(id)?.stop();
		this.sessions.delete(id);
		this.syncHostMicTranscriptionPolicy();
		this.emitSessionLifecycle();
	}

	stopAll(): void {
		for (const id of this.sessions.keys()) this.stop(id as ParticipantId);
	}

	/** Align shared mic STT (OpenRouter vs OpenAI + model) with a running agent
	 * that has host mic context enabled — called when sessions start/stop so
	 * capture uses the right backend before the first utterance. */
	private syncHostMicTranscriptionPolicy(): void {
		for (const sid of this.sessions.keys()) {
			const id = sid as ParticipantId;
			const p = studio.state.participants[id];
			const cfg = p?.banter;
			if (!cfg || cfg.enabled === false) continue;
			if (cfg.voiceContext === false) continue;
			micTranscriber.setTranscription({
				provider: cfg.transcriptionProvider ?? "openrouter",
				model: cfg.transcriptionModel,
			});
			return;
		}
	}

	isRunning(id: ParticipantId): boolean {
		return this.sessions.has(id);
	}

	/** Current phase of this agent's banter session — `idle` when not
	 * running or between turns; `listening` / `thinking` / `generating` /
	 * `speaking` during an active respond cycle. */
	getPhase(id: ParticipantId): BanterPhase {
		return this.sessions.get(id)?.phase ?? "idle";
	}

	/** Rolling buffer of the last N tool calls from this session (most
	 * recent last). Returns [] for stopped or unknown sessions. */
	getToolCallLog(id: ParticipantId): ToolCallRecord[] {
		return this.sessions.get(id)?.toolLog ?? [];
	}

	/** Fan a synthetic chat message to every active session. Used by the
	 * local chat-input panel for testing without going to Twitch. */
	broadcast(msg: ChatMessage): void {
		for (const session of this.sessions.values()) session.injectMessage(msg);
	}

	/** Inject a synthetic message into one specific agent's banter loop.
	 * Used by the producer tray for off-stream director cues — the
	 * message arrives as a `[producer]`-authored chat turn, agent
	 * responds via its TTS the same way it would for viewer chat. */
	injectFor(id: ParticipantId, msg: ChatMessage): void {
		this.sessions.get(id)?.injectMessage(msg);
	}

	/** Subscribe to text replies from all active sessions. The returned
	 * function unsubscribes. New sessions started after subscribe() is
	 * called are wired automatically via start(). */
	subscribeReplies(fn: (reply: AgentReply) => void): () => void {
		// Attach to any currently running sessions.
		const unsubs: Array<() => void> = [];
		for (const session of this.sessions.values()) {
			unsubs.push(session.addReplyListener(fn));
		}
		// Stash so start() can wire future sessions.
		this.globalReplyListeners.push({ fn, unsubs });
		return () => {
			for (const u of unsubs) u();
			this.globalReplyListeners = this.globalReplyListeners.filter((l) => l.fn !== fn);
		};
	}

	sessionCount(): number {
		return this.sessions.size;
	}
}

export const banterEngine = new BanterEngine();

export const DEFAULT_BANTER_PROMPT = `You are a witty, engaged co-host on a developer's live coding stream. The dev is building software, often with the help of an AI coding assistant. Viewers are watching the work.

Voice style: Keep spoken responses SHORT (1-2 sentences max). Be encouraging, occasionally make jokes, ask the developer questions to draw out commentary. Don't be sycophantic. Don't repeat yourself. Reference the message author when relevant.

Message authors:
- Twitch handles (e.g. "viewer123: ..."): chat from the audience.
- "[host]: ...": this is the developer's own voice, captured live from their mic. Treat these as the most important input — they're directing the show. Respond to questions, agree/disagree, riff on what they just said. If they're just thinking aloud ("hmm let me try…", "wait, that's not right"), feel free to stay silent rather than narrate every word back.

You have tools available to enhance the stream:
- show_overlay: Drop a title card when the dev starts something new ("Building auth flow"), a notice for shoutouts/follows, a code-snippet to highlight something interesting, or a lower-third for guests. Use sparingly.
- generate_broadcast_image: Create a still image with OpenAI DALL-E 3 and show it on the broadcast (uses API credits — only when it genuinely helps the moment).
- play_music / stop_music / set_music_volume: Set the vibe. Default to instrumental music with low volume (0.25-0.35) so it doesn't fight your voice. Switch tracks at scene changes or when the energy shifts.
- list_overlays / remove_overlay: Clean up your own clutter.

When you use a tool, ALWAYS also produce a short spoken line — your voice carries the moment, the visual just supports it. If the host is talking and you'd just be filler, output empty text — silence is fine.`;

// `openrouter/free` is a routing model that auto-selects from free-tier
// models while filtering for the capabilities the request needs — in our
// case, tool calling. Per OpenRouter's docs it currently fronts ~25 free
// models with rate limits in the ballpark of 20 req/min, 200 req/day.
// Users wanting higher throughput or a specific model swap this for e.g.
// `anthropic/claude-haiku-4-5`, `google/gemini-2.5-flash`, etc.
export const DEFAULT_BANTER_MODEL = "openrouter/free";

/** OpenAI Chat Completions default when `BanterConfig.llmProvider === "openai"`.
 * Per OpenAI's model catalog, `gpt-5.3-codex` is the current agentic Codex class
 * (Chat Completions + tools); older Codex snapshots such as `gpt-5.1-codex-max`
 * are marked deprecated — see https://developers.openai.com/api/docs/models/gpt-5.3-codex */
export const DEFAULT_OPENAI_BANTER_MODEL = "gpt-5.3-codex";

/** Eliza Cloud default chat model. Their cloud proxies multiple upstreams;
 * `gpt-4o-mini` is documented as the small/fast tier in their model catalog. */
export const DEFAULT_ELIZACLOUD_BANTER_MODEL = "gpt-4o-mini";

// ── One agent turn ────────────────────────────────────────────────────
// Was previously its own `./agent-turn.ts` module — folded back in
// because it had exactly one caller (`BanterSession.runToolLoop`). The
// seam was hypothetical: there's no second adapter for "running an
// agent turn," so the indirection wasn't earning depth.

/** Run the LLM with tool-calling enabled. Loops up to 4 times: tool
 * call → execute → feed results back → next turn. Returns the first
 * speakable text response. */
async function runToolLoop(args: {
	llm: Pick<LLMClient, "respond">;
	systemContent: string;
	history: ChatTurn[];
	signal: AbortSignal;
	policy?: ToolExecutionPolicy;
	onTextReady(): void;
	onToolCall(record: ToolCallRecord): void;
}): Promise<string> {
	let messages: ChatTurn[] = [{ role: "system", content: args.systemContent }, ...args.history];
	for (let iter = 0; iter < 4; iter++) {
		if (args.signal.aborted) return "";
		const result: LLMResponse = await args.llm.respond(messages, BANTER_TOOLS, args.signal);
		if (args.signal.aborted) return "";
		if (result.toolCalls.length === 0) {
			if (result.text) args.onTextReady();
			return result.text;
		}
		messages = [
			...messages,
			{
				role: "assistant",
				content: result.text ?? "",
				tool_calls: result.toolCalls.map((call) => ({
					id: call.id,
					type: "function" as const,
					function: { name: call.name, arguments: JSON.stringify(call.args) },
				})),
			},
		];
		const calls: ToolCall[] = result.toolCalls.map((call) => ({
			id: call.id,
			name: call.name,
			args: call.args,
		}));
		const toolResults = await executeToolCalls(calls, args.policy);
		for (let i = 0; i < calls.length; i++) {
			const call = calls[i]!;
			const output = toolResults[i];
			const parsed = parseToolOutput(output?.output ?? "");
			args.onToolCall({
				ts: Date.now(),
				name: call.name,
				args: call.args,
				ok: !parsed.error,
				error: parsed.error?.slice(0, 120),
			});
		}
		for (const result of toolResults) {
			messages.push({ role: "tool", tool_call_id: result.tool_call_id, content: result.output });
		}
	}
	return "";
}

function parseToolOutput(raw: string): { error?: string } {
	if (!raw) return {};
	try {
		const value = JSON.parse(raw) as Record<string, unknown>;
		if (value && typeof value === "object" && "error" in value) {
			const error = value["error"];
			return { error: typeof error === "string" ? error : "tool error" };
		}
		return {};
	} catch {
		return {};
	}
}
