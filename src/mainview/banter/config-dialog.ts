// Modal that configures banter for an agent. Resolves with the new
// BanterConfig (or null on cancel). The participant tile saves the config
// to state + (re)starts the engine.

import { Modal } from "../components/overlays";
import { DEFAULT_BANTER_PROMPT, DEFAULT_BANTER_MODEL, DEFAULT_OPENAI_BANTER_MODEL, DEFAULT_ELIZACLOUD_BANTER_MODEL } from "./banter-engine";
import { SAFE_TOOL_PERMISSIONS } from "./tool-policy";
import { getStoredApiKey } from "../tts/registry";
import { hasSecret } from "../auth/secrets-cache";
import { OPENAI_API_KEY } from "../auth/openai-api";
import { TRANSCRIBE_MODEL_OPTIONS, DEFAULT_TRANSCRIBE_MODEL } from "../transcription/openrouter-stt";
import {
	OPENAI_TRANSCRIBE_MODEL_OPTIONS,
	DEFAULT_OPENAI_TRANSCRIBE_MODEL,
} from "../transcription/openai-stt";
import {
	ELIZACLOUD_TRANSCRIBE_MODEL_OPTIONS,
	DEFAULT_ELIZACLOUD_TRANSCRIBE_MODEL,
} from "../transcription/elizacloud-stt";
import type { BanterConfig, BanterLlmProvider } from "../core/types";

export function pickBanterConfig(initial?: BanterConfig): Promise<BanterConfig | null> {
	return new Promise((resolve) => {
		let resolved = false;
		const resolveOnce = (v: BanterConfig | null): void => {
			if (resolved) return;
			resolved = true;
			resolve(v);
		};

		const hasOpenRouterKey = !!getStoredApiKey("openrouter");
		const hasOpenAiKey = hasSecret(OPENAI_API_KEY);

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
				<span>LLM provider</span>
				<select data-field="llmProvider">
					<option value="openrouter">OpenRouter</option>
					<option value="openai">OpenAI platform key</option>
					<option value="openai-codex">ChatGPT (Codex OAuth) — text only</option>
					<option value="elizacloud">Eliza Cloud</option>
				</select>
				<small class="tts-config__hint">OpenRouter: one OAuth login covers chat, TTS, and STT. OpenAI platform: <code>sk-</code> key for chat, TTS, transcriptions, and images. ChatGPT (Codex): OAuth-bound; chat/text only (voice + image still need the platform key). Eliza Cloud: pasted key, OpenAI-compatible — chat + image + voice cloning.</small>
			</label>

			<label class="tts-config__row">
				<span>LLM model</span>
				<input type="text" data-field="llmModel" />
				<small class="tts-config__hint" data-hint="llm-model"></small>
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
			<small class="tts-config__hint">Transcribes your microphone and feeds each utterance to the agent as a chat message from [host]. Requires a non-agent audio source — add a Microphone source or a camera with mic. Rate-limited to 14 utterances/min as a budget guard. Choose the STT API and model below (OpenRouter vs OpenAI each use their own key).</small>

			<label class="tts-config__row">
				<span>Mic transcription API</span>
				<select data-field="transcriptionProvider">
					<option value="openrouter">OpenRouter</option>
					<option value="openai">OpenAI</option>
					<option value="elizacloud">Eliza Cloud</option>
				</select>
			</label>

			<label class="tts-config__row">
				<span>Transcription model</span>
				<select data-field="transcriptionModel"></select>
				<small class="tts-config__hint" data-hint="trx-model"></small>
			</label>

			<label class="tts-config__row tts-config__row--inline">
				<input type="checkbox" data-field="visionProgramPreview" />
				<span>Attach program preview to each chat turn (vision)</span>
			</label>
			<small class="tts-config__hint">Sends a compressed JPEG of the composited broadcast with the latest user message so vision-capable models see layout. Throttled (~15s per agent). Uses extra tokens.</small>

			<label class="tts-config__row">
				<span>Autonomy</span>
				<select data-field="autonomyLevel">
					<option value="suggested">Suggested — draft actions for approval</option>
					<option value="auto-safe">Auto-safe — low-risk actions only</option>
					<option value="full">Full — act within enabled permissions</option>
				</select>
				<small class="tts-config__hint">Medium/high-risk actions appear in the producer tray for approval unless this is set to Full.</small>
			</label>

			<label class="tts-config__row tts-config__row--inline">
				<input type="checkbox" data-field="controlOverlays" />
				<span>Allow overlays and lower thirds</span>
			</label>

			<label class="tts-config__row tts-config__row--inline">
				<input type="checkbox" data-field="controlMusic" />
				<span>Allow music control</span>
			</label>

			${!hasOpenRouterKey && !hasOpenAiKey ? `
			<div class="tts-config__footer">
				⚠ No LLM API key found. Connect <strong>OpenRouter</strong> from the account menu, or save an <strong>OpenAI API key</strong> in Settings.
			</div>` : ""}

			<div class="tts-config__actions">
				<button type="button" data-action="cancel">Cancel</button>
				<button type="button" data-action="save" class="primary">Save</button>
			</div>
		`;

		const enabled = body.querySelector<HTMLInputElement>("[data-field=enabled]")!;
		const channel = body.querySelector<HTMLInputElement>("[data-field=twitchChannel]")!;
		const model = body.querySelector<HTMLInputElement>("[data-field=llmModel]")!;
		const llmProvider = body.querySelector<HTMLSelectElement>("[data-field=llmProvider]")!;
		const modelHint = body.querySelector<HTMLElement>("[data-hint=llm-model]")!;

		const hintOpenRouter =
			'Default <code>openrouter/free</code> auto-routes to free models that support tool calling (rate limits apply). For higher throughput: <code>anthropic/claude-haiku-4-5</code>, <code>google/gemini-2.5-flash</code>, or any model from <a href="https://openrouter.ai/models?supported_parameters=tools" target="_blank" rel="noopener">openrouter.ai/models?supported_parameters=tools</a>.';
		const hintOpenAi =
			'Default <code>gpt-5.3-codex</code> matches the current Codex-class agentic model (Chat Completions + tools). For the general flagship, OpenAI documents <code>gpt-5.5</code> as the default starting point. Verify ids in <a href="https://platform.openai.com/docs/models" target="_blank" rel="noopener">platform.openai.com/docs/models</a> or the <a href="https://developers.openai.com/api/docs/models/all" target="_blank" rel="noopener">full model list</a>.';
		const hintCodex =
			'Bound to your ChatGPT Plus/Pro subscription via OAuth. Use Codex-class model ids that ChatGPT exposes through the Codex backend (e.g. <code>gpt-5.3-codex</code>). Requests charge against your ChatGPT plan, not the platform API.';
		const hintElizaCloud =
			'OpenAI-compatible chat completions at <code>elizacloud.ai/api/v1</code>. Documented model ids include <code>gpt-4o-mini</code> (small/fast), <code>gpt-4o</code>, <code>claude-3-5-sonnet</code>, <code>gemini-2.0-flash</code>. See <a href="https://www.elizacloud.ai/docs/installation" target="_blank" rel="noopener">elizacloud.ai/docs</a>.';

		const syncModelHint = (): void => {
			const p = llmProvider.value as BanterLlmProvider;
			modelHint.innerHTML = p === "openai" ? hintOpenAi : p === "openai-codex" ? hintCodex : p === "elizacloud" ? hintElizaCloud : hintOpenRouter;
		};

		const prov: BanterLlmProvider = initial?.llmProvider ?? "openrouter";
		llmProvider.value = prov;
		model.value = initial?.llmModel ?? pickDefaultModel(prov);
		syncModelHint();
		llmProvider.addEventListener("change", () => {
			syncModelHint();
			const p = llmProvider.value as BanterLlmProvider;
			// If the current model has an OpenRouter slug shape, swap it
			// when leaving OpenRouter so we don't carry "vendor/model" into
			// a non-OpenRouter endpoint that rejects the prefix.
			if (p !== "openrouter" && model.value.includes("/")) {
				model.value = pickDefaultModel(p);
			}
		});

		const prompt = body.querySelector<HTMLTextAreaElement>("[data-field=systemPrompt]")!;
		const vad = body.querySelector<HTMLInputElement>("[data-field=voiceActivityGate]")!;
		const proactive = body.querySelector<HTMLInputElement>("[data-field=proactiveOnTranscript]")!;
		const voiceContext = body.querySelector<HTMLInputElement>("[data-field=voiceContext]")!;
		const autonomyLevel = body.querySelector<HTMLSelectElement>("[data-field=autonomyLevel]")!;
		const controlOverlays = body.querySelector<HTMLInputElement>("[data-field=controlOverlays]")!;
		const controlMusic = body.querySelector<HTMLInputElement>("[data-field=controlMusic]")!;
		const transcriptionProvider = body.querySelector<HTMLSelectElement>("[data-field=transcriptionProvider]")!;
		const transcriptionModel = body.querySelector<HTMLSelectElement>("[data-field=transcriptionModel]")!;
		const trxModelHint = body.querySelector<HTMLElement>("[data-hint=trx-model]")!;
		const visionProgramPreview = body.querySelector<HTMLInputElement>("[data-field=visionProgramPreview]")!;

		const hintTrxOpenRouter =
			"OpenRouter STT — cumulative cost from the API when available; perf HUD (⌘⇧P). Gemini Flash is the cheap default.";
		const hintTrxOpenAi = "OpenAI <code>/v1/audio/transcriptions</code> — uses your saved OpenAI platform key.";
		const hintTrxElizaCloud = "Eliza Cloud <code>/api/v1/audio/transcriptions</code> — uses your saved Eliza Cloud key.";

		type TrxProvider = "openrouter" | "openai" | "elizacloud";
		const fillTrxModelOptions = (): void => {
			const p = transcriptionProvider.value as TrxProvider;
			const opts =
				p === "openai"
					? OPENAI_TRANSCRIBE_MODEL_OPTIONS
					: p === "elizacloud"
						? ELIZACLOUD_TRANSCRIBE_MODEL_OPTIONS
						: TRANSCRIBE_MODEL_OPTIONS;
			const prev = transcriptionModel.value;
			transcriptionModel.innerHTML = opts.map((o) => `<option value="${o.id}">${o.label} — ${o.note}</option>`).join("");
			const ids = new Set(opts.map((o) => o.id));
			if (ids.has(prev)) transcriptionModel.value = prev;
			else
				transcriptionModel.value =
					p === "openai" ? DEFAULT_OPENAI_TRANSCRIBE_MODEL : p === "elizacloud" ? DEFAULT_ELIZACLOUD_TRANSCRIBE_MODEL : DEFAULT_TRANSCRIBE_MODEL;
			trxModelHint.innerHTML = p === "openai" ? hintTrxOpenAi : p === "elizacloud" ? hintTrxElizaCloud : hintTrxOpenRouter;
		};

		enabled.checked = initial?.enabled ?? true;
		channel.value = initial?.twitchChannel ?? "";
		prompt.value = initial?.systemPrompt ?? DEFAULT_BANTER_PROMPT;
		vad.checked = initial?.voiceActivityGate ?? true;
		proactive.checked = initial?.proactiveOnTranscript ?? true;
		voiceContext.checked = initial?.voiceContext ?? true;
		autonomyLevel.value = initial?.autonomyLevel ?? "auto-safe";
		controlOverlays.checked = initial?.toolPermissions?.controlOverlays ?? SAFE_TOOL_PERMISSIONS.controlOverlays;
		controlMusic.checked = initial?.toolPermissions?.controlMusic ?? SAFE_TOOL_PERMISSIONS.controlMusic;
		transcriptionProvider.value = initial?.transcriptionProvider ?? "openrouter";
		fillTrxModelOptions();
		if (initial?.transcriptionModel) transcriptionModel.value = initial.transcriptionModel;
		visionProgramPreview.checked = initial?.visionProgramPreview ?? false;
		transcriptionProvider.addEventListener("change", fillTrxModelOptions);

		const modal = new Modal({
			title: "Banter settings",
			body,
			onClose: () => resolveOnce(null),
		});

		body.querySelector<HTMLButtonElement>("[data-action=cancel]")!.addEventListener("click", () => modal.close());
		body.querySelector<HTMLButtonElement>("[data-action=save]")!.addEventListener("click", () => {
			const p = llmProvider.value as BanterLlmProvider;
			const defaultModel = pickDefaultModel(p);
			const config: BanterConfig = {
				enabled: enabled.checked,
				twitchChannel: channel.value.trim(),
				llmProvider: p,
				llmModel: model.value.trim() || defaultModel,
				systemPrompt: prompt.value.trim() || DEFAULT_BANTER_PROMPT,
				voiceActivityGate: vad.checked,
				proactiveOnTranscript: proactive.checked,
				voiceContext: voiceContext.checked,
				transcriptionProvider: transcriptionProvider.value as "openrouter" | "openai" | "elizacloud",
				transcriptionModel: transcriptionModel.value,
				visionProgramPreview: visionProgramPreview.checked,
				autonomyLevel: autonomyLevel.value as BanterConfig["autonomyLevel"],
				toolPermissions: {
					controlOverlays: controlOverlays.checked,
					controlMusic: controlMusic.checked,
				},
			};
			resolveOnce(config);
			modal.close();
		});
	});
}

function pickDefaultModel(provider: BanterLlmProvider): string {
	switch (provider) {
		case "openai":
		case "openai-codex":
			return DEFAULT_OPENAI_BANTER_MODEL;
		case "elizacloud":
			return DEFAULT_ELIZACLOUD_BANTER_MODEL;
		default:
			return DEFAULT_BANTER_MODEL;
	}
}
