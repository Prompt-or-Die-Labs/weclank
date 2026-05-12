// Modal that configures banter for an agent. Resolves with the new
// BanterConfig (or null on cancel). The participant tile saves the config
// to state + (re)starts the engine.

import { Modal } from "../components/overlays";
import { DEFAULT_BANTER_PROMPT, DEFAULT_BANTER_MODEL } from "./banter-engine";
import { getStoredApiKey } from "../tts/registry";
import { TRANSCRIBE_MODEL_OPTIONS, DEFAULT_TRANSCRIBE_MODEL } from "../transcription/openrouter-stt";
import type { BanterConfig } from "../core/types";

export function pickBanterConfig(initial?: BanterConfig): Promise<BanterConfig | null> {
	return new Promise((resolve) => {
		let resolved = false;
		const resolveOnce = (v: BanterConfig | null): void => {
			if (resolved) return;
			resolved = true;
			resolve(v);
		};

		const hasOpenRouterKey = !!getStoredApiKey("openrouter");

		const body = document.createElement("div");
		body.className = "tts-config";
		body.innerHTML = `
			<p class="device-picker__intro">Wire this agent up to Twitch chat. The agent reads new messages, drafts replies with the LLM, and speaks them through its TTS voice.</p>

			<label class="tts-config__row tts-config__row--inline">
				<input type="checkbox" data-field="enabled" />
				<span>Enabled</span>
			</label>

			<label class="tts-config__row">
				<span>Twitch channel</span>
				<input type="text" data-field="twitchChannel" placeholder="my_channel_name" />
				<small class="tts-config__hint">Anonymous read-only — no Twitch login needed for the agent.</small>
			</label>

			<label class="tts-config__row">
				<span>LLM model (OpenRouter)</span>
				<input type="text" data-field="llmModel" />
				<small class="tts-config__hint">Default <code>openrouter/free</code> auto-routes to free models that support tool calling (rate limits apply). For higher throughput: <code>anthropic/claude-haiku-4-5</code>, <code>google/gemini-2.5-flash</code>, or any model from <a href="https://openrouter.ai/models?supported_parameters=tools" target="_blank" rel="noopener">openrouter.ai/models?supported_parameters=tools</a>.</small>
			</label>

			<label class="tts-config__row">
				<span>Personality / system prompt</span>
				<textarea data-field="systemPrompt" rows="6"></textarea>
			</label>

			<label class="tts-config__row tts-config__row--inline">
				<input type="checkbox" data-field="voiceActivityGate" />
				<span>Pause when I'm speaking (recommended)</span>
			</label>

			<label class="tts-config__row tts-config__row--inline">
				<input type="checkbox" data-field="proactiveOnTranscript" />
				<span>Comment unprompted on coding-feed activity</span>
			</label>
			<small class="tts-config__hint">Requires the coding feed (right rail → Coding). When chat is quiet but your AI is working, the agent occasionally reacts to the work itself.</small>

			<label class="tts-config__row tts-config__row--inline">
				<input type="checkbox" data-field="voiceContext" />
				<span>Listen to my mic for context</span>
			</label>
			<small class="tts-config__hint">Transcribes your microphone via OpenRouter's <code>/audio/transcriptions</code> endpoint and feeds each utterance to the agent as a chat message from [host]. Requires a non-agent audio source — add a Microphone source or a camera with mic. Rate-limited to 14 utterances/min as a budget guard.</small>

			<label class="tts-config__row">
				<span>Transcription model</span>
				<select data-field="transcriptionModel">
					${TRANSCRIBE_MODEL_OPTIONS.map((o) => `<option value="${o.id}">${o.label} — ${o.note}</option>`).join("")}
				</select>
				<small class="tts-config__hint">Studio-wide. Gemini 2.5 Flash is the cheapest token-priced option; Whisper bills per second of audio. Cumulative cost shown in the perf HUD (⌘⇧P).</small>
			</label>

			${hasOpenRouterKey ? "" : `
			<div class="tts-config__footer">
				⚠ No OpenRouter API key found. Open <strong>Voice settings → Provider: OpenRouter</strong> on any agent and save your key first — the banter engine reuses it.
			</div>`}

			<div class="tts-config__actions">
				<button type="button" data-action="cancel">Cancel</button>
				<button type="button" data-action="save" class="primary">Save</button>
			</div>
		`;

		const enabled = body.querySelector<HTMLInputElement>("[data-field=enabled]")!;
		const channel = body.querySelector<HTMLInputElement>("[data-field=twitchChannel]")!;
		const model = body.querySelector<HTMLInputElement>("[data-field=llmModel]")!;
		const prompt = body.querySelector<HTMLTextAreaElement>("[data-field=systemPrompt]")!;
		const vad = body.querySelector<HTMLInputElement>("[data-field=voiceActivityGate]")!;
		const proactive = body.querySelector<HTMLInputElement>("[data-field=proactiveOnTranscript]")!;
		const voiceContext = body.querySelector<HTMLInputElement>("[data-field=voiceContext]")!;
		const transcriptionModel = body.querySelector<HTMLSelectElement>("[data-field=transcriptionModel]")!;

		enabled.checked = initial?.enabled ?? true;
		channel.value = initial?.twitchChannel ?? "";
		model.value = initial?.llmModel ?? DEFAULT_BANTER_MODEL;
		prompt.value = initial?.systemPrompt ?? DEFAULT_BANTER_PROMPT;
		vad.checked = initial?.voiceActivityGate ?? true;
		proactive.checked = initial?.proactiveOnTranscript ?? true;
		voiceContext.checked = initial?.voiceContext ?? true;
		transcriptionModel.value = initial?.transcriptionModel ?? DEFAULT_TRANSCRIBE_MODEL;

		const modal = new Modal({
			title: "Banter settings",
			body,
			onClose: () => resolveOnce(null),
		});

		body.querySelector<HTMLButtonElement>("[data-action=cancel]")!.addEventListener("click", () => modal.close());
		body.querySelector<HTMLButtonElement>("[data-action=save]")!.addEventListener("click", () => {
			const config: BanterConfig = {
				enabled: enabled.checked,
				twitchChannel: channel.value.trim(),
				llmModel: model.value.trim() || DEFAULT_BANTER_MODEL,
				systemPrompt: prompt.value.trim() || DEFAULT_BANTER_PROMPT,
				voiceActivityGate: vad.checked,
				proactiveOnTranscript: proactive.checked,
				voiceContext: voiceContext.checked,
				transcriptionModel: transcriptionModel.value,
			};
			resolveOnce(config);
			modal.close();
		});
	});
}
