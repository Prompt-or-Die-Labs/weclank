// Modal for creating / editing a text-only assistant participant.
//
// Presents a role picker (co-host, chat-monitor, producer, overlay-bot,
// code-narrator, custom) each with a pre-canned system prompt tuned to the
// Studio Live context. The user can switch roles to load a different preset,
// or pick "custom" to write their own. They can also override the LLM model
// and Twitch channel.
//
// Resolves with { name, role, banterConfig } or null on cancel.

import { Modal } from "../components/overlays";
import { DEFAULT_BANTER_MODEL, DEFAULT_OPENAI_BANTER_MODEL } from "./banter-engine";
import { FULL_TOOL_PERMISSIONS, SAFE_TOOL_PERMISSIONS } from "./tool-policy";
import { getStoredApiKey } from "../tts/registry";
import { hasSecret } from "../auth/secrets-cache";
import { OPENAI_API_KEY } from "../auth/openai-api";
import { TRANSCRIBE_MODEL_OPTIONS, DEFAULT_TRANSCRIBE_MODEL } from "../transcription/openrouter-stt";
import {
	OPENAI_TRANSCRIBE_MODEL_OPTIONS,
	DEFAULT_OPENAI_TRANSCRIBE_MODEL,
} from "../transcription/openai-stt";
import type {
	AgentAutonomyLevel,
	AgentToolPermissions,
	AssistantRole,
	BanterConfig,
	BanterLlmProvider,
} from "../core/types";

export interface AssistantSetup {
	displayName: string;
	role: AssistantRole;
	banterConfig: BanterConfig;
}

// ── Pre-canned system prompts ─────────────────────────────────────────────

export const ASSISTANT_ROLES: { id: AssistantRole; label: string; description: string }[] = [
	{
		id: "co-host",
		label: "Co-host",
		description: "Responds to viewer chat, keeps energy up, references what's on screen.",
	},
	{
		id: "chat-monitor",
		label: "Chat Monitor",
		description: "Watches for toxicity, summarises sentiment, flags questions the host should answer.",
	},
	{
		id: "producer",
		label: "Producer",
		description: "Off-screen director: scene transitions, music cues, pacing notes posted to the producer tray.",
	},
	{
		id: "overlay-bot",
		label: "Overlay Bot",
		description: "Tool-only: autonomously manages title cards, lower-thirds, and broadcast graphics.",
	},
	{
		id: "code-narrator",
		label: "Code Narrator",
		description: "Tracks the coding transcript feed and reacts to what the AI coding assistant is doing.",
	},
	{
		id: "custom",
		label: "Custom",
		description: "Blank canvas — write your own system prompt.",
	},
];

export const ROLE_PROMPTS: Record<AssistantRole, string> = {
	"co-host": `You are a text-only co-host on a live developer stream. You have no voice — your replies appear in the producer chat and the stream's chat overlay.

Role: Engage the audience. Respond to viewer messages, ask the host follow-up questions, hype moments when something interesting happens, and keep the energy up between coding bursts. Keep replies SHORT (1–2 sentences). Match the casual energy of a live chat stream. Reference what's on screen when the coding feed gives you context.

You have the same tools as a voice co-host (show_overlay, play_music, etc.) — use them proactively to punctuate the stream.`,

	"chat-monitor": `You are a silent chat-monitoring assistant for a live developer stream. You watch Twitch chat and the host's mic transcriptions, but you do NOT respond to viewers directly — your output goes only to the producer tray (the host's private panel).

Role:
- Flag toxic, spammy, or off-topic messages with a short note: e.g. "[flag] user123: possible spam — 4x same message"
- Summarise viewer sentiment every ~20 messages: e.g. "[vibe] Mostly positive, 3 questions about the auth bug"
- Surface questions the host should answer: e.g. "[Q] viewer99 asks: what ORM are you using?"
- Note mood shifts: "[shift] Energy dropped — chat slowed since the last error"

Be terse, actionable, producer-facing. Do not produce content for viewers.`,

	"producer": `You are an off-stream producer assistant for a live developer stream. Your output goes to the producer tray only — the host sees it but viewers do not.

Role: Director-level awareness. Watch the coding feed, chat energy, and elapsed time. Suggest:
- Scene transitions: "[cue] Good time to switch to the terminal scene — 8 min on webcam"
- Music cues: "[music] Chat is quiet — consider kicking up the tempo"
- Pacing: "[pace] You've been heads-down for 12 min. Might be time for a quick verbal update to chat"
- Overlay moments: "[overlay] Highlight this function — it's the crux of what you just explained"
- Break prompts: "[break] 45 min in — hydration check?"

Use tools (show_overlay, play_music, set_music_volume) directly when you're confident the host would approve. Flag anything uncertain as a suggestion first.`,

	"overlay-bot": `You are an automated overlay manager for a live developer stream. You work silently in the background — no text replies visible to viewers or the host unless a tool call fails.

Role: Watch the coding feed and chat. Autonomously:
- Drop a title card when a new topic/phase starts (e.g. "Building the auth flow")
- Add a lower-third for notable viewer questions that the host is addressing
- Put up a code-snippet overlay when an interesting function/snippet appears in the transcript
- Clean up overlays before they get stale — call list_overlays regularly and remove expired ones
- Use play_music / set_music_volume to maintain a steady background vibe (0.25 during speech, 0.4 during quiet)

Be conservative with sticky overlays. Prefer auto-dismissing ones. Never put up more than 2 overlays at once.`,

	"code-narrator": `You are a code-context assistant for a live developer stream. You watch the coding transcript feed (what the AI coding assistant is doing) and surface insights to the producer tray.

Role:
- Translate AI assistant actions into plain English for the host: "[context] The AI just refactored the token validator — moved validation into a middleware layer"
- Flag when the AI is stuck or looping: "[flag] 3 failed attempts at the same test — might be worth stepping in"
- Suggest what to say to viewers based on what just happened: "[say] You could explain why you chose middleware here — it's a common pattern question"
- Note technical moments worth a title card overlay

Keep it brief. One line per insight. Producer-facing only — do not generate viewer-visible content.`,

	"custom": `You are an AI assistant for a live developer stream. Define your role and behavior here.`,
};

// ── Dialog ────────────────────────────────────────────────────────────────

export function pickAssistantConfig(
	initial?: Partial<AssistantSetup>,
): Promise<AssistantSetup | null> {
	return new Promise((resolve) => {
		let resolved = false;
		const resolveOnce = (v: AssistantSetup | null): void => {
			if (resolved) return;
			resolved = true;
			resolve(v);
		};

		const hasAnyLlmKey = !!getStoredApiKey("openrouter") || hasSecret(OPENAI_API_KEY);
		const initRole: AssistantRole = initial?.role ?? "co-host";
		const initProv: BanterLlmProvider = initial?.banterConfig?.llmProvider ?? "openrouter";
		const initModel =
			initial?.banterConfig?.llmModel ??
			(initProv === "openai" ? DEFAULT_OPENAI_BANTER_MODEL : DEFAULT_BANTER_MODEL);
		const saveLabel = initial?.displayName?.trim() ? "Save changes" : "Add assistant";
		const modalTitle = initial?.displayName?.trim() ? "Edit text assistant" : "Add text assistant";

		const body = document.createElement("div");
		body.className = "tts-config";
		body.innerHTML = `
			<p class="device-picker__intro">Text-only assistants run the same LLM loop as voice co-hosts but have no TTS voice — their replies appear in the producer tray and chat panel. Each role has a pre-tuned system prompt you can customise.</p>

			<label class="tts-config__row">
				<span>Name</span>
				<input type="text" data-field="name" value="${escHtml(initial?.displayName ?? "")}" placeholder="e.g. Aria, Monitor, Director" />
			</label>

			<label class="tts-config__row">
				<span>Role</span>
				<select data-field="role">
					${ASSISTANT_ROLES.map((r) => `<option value="${r.id}"${r.id === initRole ? " selected" : ""}>${r.label} — ${r.description}</option>`).join("")}
				</select>
			</label>

			<label class="tts-config__row">
				<span>LLM provider</span>
				<select data-field="llmProvider">
					<option value="openrouter"${initProv === "openrouter" ? " selected" : ""}>OpenRouter</option>
					<option value="openai"${initProv === "openai" ? " selected" : ""}>OpenAI (API key)</option>
				</select>
				<small class="tts-config__hint">OpenRouter covers TTS + STT + default LLM. OpenAI: platform <code>sk-</code> key for chat, speech, transcriptions, and images (Settings).</small>
			</label>

			<label class="tts-config__row">
				<span>LLM model</span>
				<input type="text" data-field="model" value="${escHtml(initModel)}" />
				<small class="tts-config__hint" data-hint="llm-model"></small>
			</label>

			<label class="tts-config__row">
				<span>Twitch channel <small>(optional)</small></span>
				<input type="text" data-field="channel" value="${escHtml(initial?.banterConfig?.twitchChannel ?? "")}" placeholder="channel_name" autocapitalize="off" />
				<small class="tts-config__hint">Leave blank to run on mic transcription + coding feed only.</small>
			</label>

			<label class="tts-config__row">
				<span>System prompt</span>
				<textarea data-field="prompt" rows="8"></textarea>
				<small class="tts-config__hint">Loaded from the role preset above. Edit freely — switching role reloads the preset.</small>
			</label>

			<label class="tts-config__row tts-config__row--inline">
				<input type="checkbox" data-field="proactive" ${(initial?.banterConfig?.proactiveOnTranscript ?? true) ? "checked" : ""} />
				<span>React to coding-feed activity when chat is quiet</span>
			</label>

			<label class="tts-config__row tts-config__row--inline">
				<input type="checkbox" data-field="voiceContext" ${(initial?.banterConfig?.voiceContext ?? true) ? "checked" : ""} />
				<span>Listen to host mic for context</span>
			</label>
			<small class="tts-config__hint">Same mic transcription path as voice agents — pick API + model below.</small>

			<label class="tts-config__row">
				<span>Mic transcription API</span>
				<select data-field="trxProvider">
					<option value="openrouter">OpenRouter</option>
					<option value="openai">OpenAI</option>
				</select>
			</label>

			<label class="tts-config__row">
				<span>Transcription model</span>
				<select data-field="trxModel"></select>
				<small class="tts-config__hint" data-hint="trx-model"></small>
			</label>

			<label class="tts-config__row tts-config__row--inline">
				<input type="checkbox" data-field="visionPreview" />
				<span>Attach program preview to each turn (vision)</span>
			</label>

			<label class="tts-config__row">
				<span>Autonomy</span>
				<select data-field="autonomy">
					<option value="suggested">Suggested — draft actions for approval</option>
					<option value="auto-safe">Auto-safe — low-risk actions only</option>
					<option value="full">Full — act within enabled permissions</option>
				</select>
				<small class="tts-config__hint">Suggested actions appear in the producer tray. Full is best reserved for trusted overlay bots.</small>
			</label>

			<label class="tts-config__row tts-config__row--inline">
				<input type="checkbox" data-field="controlOverlays" />
				<span>Allow overlays and lower thirds</span>
			</label>

			<label class="tts-config__row tts-config__row--inline">
				<input type="checkbox" data-field="controlMusic" />
				<span>Allow music control</span>
			</label>

			${hasAnyLlmKey ? "" : `
			<div class="tts-config__footer">
				⚠ No LLM API key found. Connect <strong>OpenRouter</strong> from the account menu, or save an <strong>OpenAI API key</strong> in Settings.
			</div>`}

			<div class="tts-config__actions">
				<button type="button" data-action="cancel">Cancel</button>
				<button type="button" data-action="save" class="primary">${escHtml(saveLabel)}</button>
			</div>
		`;

		const nameEl = body.querySelector<HTMLInputElement>("[data-field=name]")!;
		const roleEl = body.querySelector<HTMLSelectElement>("[data-field=role]")!;
		const llmProviderEl = body.querySelector<HTMLSelectElement>("[data-field=llmProvider]")!;
		const modelEl = body.querySelector<HTMLInputElement>("[data-field=model]")!;
		const modelHint = body.querySelector<HTMLElement>("[data-hint=llm-model]")!;

		const hintOpenRouter =
			'<code>openrouter/free</code> auto-routes to free models. For higher throughput: <code>anthropic/claude-haiku-4-5</code>, <code>google/gemini-2.5-flash</code>.';
		const hintOpenAi =
			'Default <code>gpt-5.3-codex</code> (current Codex-class agentic model). Alternative: <code>gpt-5.5</code> (documented flagship). Catalog: <a href="https://developers.openai.com/api/docs/models/all" target="_blank" rel="noopener">developers.openai.com/api/docs/models/all</a>.';

		const syncModelHint = (): void => {
			modelHint.innerHTML = llmProviderEl.value === "openai" ? hintOpenAi : hintOpenRouter;
		};
		syncModelHint();
		llmProviderEl.addEventListener("change", () => {
			syncModelHint();
			if (llmProviderEl.value === "openai" && modelEl.value.includes("/")) {
				modelEl.value = DEFAULT_OPENAI_BANTER_MODEL;
			}
		});
		const channelEl = body.querySelector<HTMLInputElement>("[data-field=channel]")!;
		const promptEl = body.querySelector<HTMLTextAreaElement>("[data-field=prompt]")!;
		const proactiveEl = body.querySelector<HTMLInputElement>("[data-field=proactive]")!;
		const voiceContextEl = body.querySelector<HTMLInputElement>("[data-field=voiceContext]")!;
		const autonomyEl = body.querySelector<HTMLSelectElement>("[data-field=autonomy]")!;
		const controlOverlaysEl = body.querySelector<HTMLInputElement>("[data-field=controlOverlays]")!;
		const controlMusicEl = body.querySelector<HTMLInputElement>("[data-field=controlMusic]")!;
		const trxProviderEl = body.querySelector<HTMLSelectElement>("[data-field=trxProvider]")!;
		const trxModelEl = body.querySelector<HTMLSelectElement>("[data-field=trxModel]")!;
		const trxModelHint = body.querySelector<HTMLElement>("[data-hint=trx-model]")!;
		const visionPreviewEl = body.querySelector<HTMLInputElement>("[data-field=visionPreview]")!;

		const hintTrxOpenRouter =
			"OpenRouter STT — cheap default is Gemini Flash; cumulative cost in perf HUD when available.";
		const hintTrxOpenAi = "OpenAI native transcriptions — uses your saved OpenAI key.";

		const fillTrxModelOptions = (): void => {
			const p = trxProviderEl.value as "openrouter" | "openai";
			const opts = p === "openai" ? OPENAI_TRANSCRIBE_MODEL_OPTIONS : TRANSCRIBE_MODEL_OPTIONS;
			const prev = trxModelEl.value;
			trxModelEl.innerHTML = opts.map((o) => `<option value="${o.id}">${o.label} — ${o.note}</option>`).join("");
			const ids = new Set(opts.map((o) => o.id));
			if (ids.has(prev)) trxModelEl.value = prev;
			else trxModelEl.value = p === "openai" ? DEFAULT_OPENAI_TRANSCRIBE_MODEL : DEFAULT_TRANSCRIBE_MODEL;
			trxModelHint.innerHTML = p === "openai" ? hintTrxOpenAi : hintTrxOpenRouter;
		};

		trxProviderEl.value = initial?.banterConfig?.transcriptionProvider ?? "openrouter";
		fillTrxModelOptions();
		if (initial?.banterConfig?.transcriptionModel) trxModelEl.value = initial.banterConfig.transcriptionModel;
		visionPreviewEl.checked = initial?.banterConfig?.visionProgramPreview ?? false;
		trxProviderEl.addEventListener("change", fillTrxModelOptions);

		const applyPolicyFields = (autonomy: AgentAutonomyLevel, permissions: AgentToolPermissions): void => {
			autonomyEl.value = autonomy;
			controlOverlaysEl.checked = permissions.controlOverlays;
			controlMusicEl.checked = permissions.controlMusic;
		};

		promptEl.value = initial?.banterConfig?.systemPrompt ?? ROLE_PROMPTS[initRole];
		applyPolicyFields(
			initial?.banterConfig?.autonomyLevel ?? defaultAutonomyForRole(initRole),
			initial?.banterConfig?.toolPermissions ?? defaultPermissionsForRole(initRole),
		);

		roleEl.addEventListener("change", () => {
			const role = roleEl.value as AssistantRole;
			promptEl.value = ROLE_PROMPTS[role];
			applyPolicyFields(defaultAutonomyForRole(role), defaultPermissionsForRole(role));
			if (!nameEl.value.trim()) {
				const def = ASSISTANT_ROLES.find((r) => r.id === role);
				if (def) nameEl.value = def.label;
			}
		});

		// Seed default name.
		if (!nameEl.value.trim()) {
			const def = ASSISTANT_ROLES.find((r) => r.id === initRole);
			if (def) nameEl.value = def.label;
		}

		const modal = new Modal({
			title: modalTitle,
			body,
			onClose: () => resolveOnce(null),
		});

		body.querySelector<HTMLButtonElement>("[data-action=cancel]")!
			.addEventListener("click", () => modal.close());

		body.querySelector<HTMLButtonElement>("[data-action=save]")!
			.addEventListener("click", () => {
				const role = roleEl.value as AssistantRole;
				const name = nameEl.value.trim() || (ASSISTANT_ROLES.find((r) => r.id === role)?.label ?? "Assistant");
				const p = llmProviderEl.value as BanterLlmProvider;
				const defModel = p === "openai" ? DEFAULT_OPENAI_BANTER_MODEL : DEFAULT_BANTER_MODEL;
				const config: BanterConfig = {
					enabled: true,
					twitchChannel: channelEl.value.trim().replace(/^#/, ""),
					llmProvider: p,
					llmModel: modelEl.value.trim() || defModel,
					systemPrompt: promptEl.value.trim() || ROLE_PROMPTS[role],
					voiceActivityGate: false, // text-only agents don't need VAD
					proactiveOnTranscript: proactiveEl.checked,
					voiceContext: voiceContextEl.checked,
					transcriptionProvider: trxProviderEl.value as "openrouter" | "openai",
					transcriptionModel: trxModelEl.value,
					visionProgramPreview: visionPreviewEl.checked,
					autonomyLevel: autonomyEl.value as AgentAutonomyLevel,
					toolPermissions: {
						controlOverlays: controlOverlaysEl.checked,
						controlMusic: controlMusicEl.checked,
					},
				};
				resolveOnce({ displayName: name, role, banterConfig: config });
				modal.close();
			});
	});
}

function defaultAutonomyForRole(role: AssistantRole): AgentAutonomyLevel {
	switch (role) {
		case "overlay-bot": return "full";
		case "co-host": return "auto-safe";
		case "chat-monitor":
		case "producer":
		case "code-narrator":
		case "custom":
			return "suggested";
	}
}

function defaultPermissionsForRole(role: AssistantRole): AgentToolPermissions {
	switch (role) {
		case "overlay-bot": return FULL_TOOL_PERMISSIONS;
		case "producer": return SAFE_TOOL_PERMISSIONS;
		case "co-host": return SAFE_TOOL_PERMISSIONS;
		case "chat-monitor":
		case "code-narrator":
		case "custom":
			return { controlOverlays: false, controlMusic: false };
	}
}

function escHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
