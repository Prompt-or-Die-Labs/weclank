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
import { DEFAULT_BANTER_MODEL } from "./banter-engine";
import { getStoredApiKey } from "../tts/registry";
import type { AssistantRole, BanterConfig } from "../core/types";

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

		const hasKey = !!getStoredApiKey("openrouter");
		const initRole: AssistantRole = initial?.role ?? "co-host";

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
				<span>LLM model (OpenRouter)</span>
				<input type="text" data-field="model" value="${escHtml(initial?.banterConfig?.llmModel ?? DEFAULT_BANTER_MODEL)}" />
				<small class="tts-config__hint"><code>openrouter/free</code> auto-routes to free models. For higher throughput: <code>anthropic/claude-haiku-4-5</code>, <code>google/gemini-2.5-flash</code>.</small>
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

			${hasKey ? "" : `
			<div class="tts-config__footer">
				⚠ No OpenRouter API key found. Connect OpenRouter from the user menu (top-right avatar) first.
			</div>`}

			<div class="tts-config__actions">
				<button type="button" data-action="cancel">Cancel</button>
				<button type="button" data-action="save" class="primary">Add assistant</button>
			</div>
		`;

		const nameEl = body.querySelector<HTMLInputElement>("[data-field=name]")!;
		const roleEl = body.querySelector<HTMLSelectElement>("[data-field=role]")!;
		const modelEl = body.querySelector<HTMLInputElement>("[data-field=model]")!;
		const channelEl = body.querySelector<HTMLInputElement>("[data-field=channel]")!;
		const promptEl = body.querySelector<HTMLTextAreaElement>("[data-field=prompt]")!;
		const proactiveEl = body.querySelector<HTMLInputElement>("[data-field=proactive]")!;
		const voiceContextEl = body.querySelector<HTMLInputElement>("[data-field=voiceContext]")!;

		// Seed prompt from role.
		promptEl.value = initial?.banterConfig?.systemPrompt ?? ROLE_PROMPTS[initRole];

		// When the role changes, reload the preset prompt (unless custom).
		roleEl.addEventListener("change", () => {
			const role = roleEl.value as AssistantRole;
			promptEl.value = ROLE_PROMPTS[role];
			// Auto-fill a default name if the field is still empty.
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
			title: "Add text assistant",
			body,
			onClose: () => resolveOnce(null),
		});

		body.querySelector<HTMLButtonElement>("[data-action=cancel]")!
			.addEventListener("click", () => modal.close());

		body.querySelector<HTMLButtonElement>("[data-action=save]")!
			.addEventListener("click", () => {
				const role = roleEl.value as AssistantRole;
				const name = nameEl.value.trim() || (ASSISTANT_ROLES.find((r) => r.id === role)?.label ?? "Assistant");
				const config: BanterConfig = {
					enabled: true,
					twitchChannel: channelEl.value.trim().replace(/^#/, ""),
					llmModel: modelEl.value.trim() || DEFAULT_BANTER_MODEL,
					systemPrompt: promptEl.value.trim() || ROLE_PROMPTS[role],
					voiceActivityGate: false, // text-only agents don't need VAD
					proactiveOnTranscript: proactiveEl.checked,
					voiceContext: voiceContextEl.checked,
				};
				resolveOnce({ displayName: name, role, banterConfig: config });
				modal.close();
			});
	});
}

function escHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
