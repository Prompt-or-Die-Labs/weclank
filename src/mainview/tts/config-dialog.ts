// Modal that captures TTS config for an agent. Resolves with the chosen
// TTSConfig, or null if the user closed/canceled. The visible fields depend
// on the selected provider — the dialog hides irrelevant rows so the user
// only fills in what matters.

import { Modal } from "../components/overlays";
import { getStoredApiKey, setStoredApiKey } from "./registry";
import type { TTSConfig, TTSProviderId } from "../core/types";

interface ProviderSchema {
	id: TTSProviderId;
	label: string;
	description: string;
	keyLabel: string;
	keyHint?: string;
	voiceLabel?: string;
	voicePlaceholder?: string;
	voiceHint?: string;
	modelLabel?: string;
	modelPlaceholder?: string;
	modelHint?: string;
	extras?: Array<"format" | "baseUrl" | "style" | "instrumental">;
	footer?: string;
}

const SCHEMAS: Record<TTSProviderId, ProviderSchema> = {
	elevenlabs: {
		id: "elevenlabs",
		label: "ElevenLabs",
		description: "Realtime-friendly TTS with cloning. ~75ms first-byte.",
		keyLabel: "ElevenLabs API key",
		keyHint: "Find under Profile → API Keys at elevenlabs.io.",
		voiceLabel: "Voice id",
		voicePlaceholder: "21m00Tcm4TlvDq8ikWAM",
		voiceHint: "Voice id from elevenlabs.io/voice-lab. Leave blank for Rachel.",
		modelLabel: "Model id",
		modelPlaceholder: "eleven_turbo_v2_5",
	},
	openrouter: {
		id: "openrouter",
		label: "OpenRouter",
		description: "OpenAI-compatible chat completions with audio output.",
		keyLabel: "OpenRouter API key",
		keyHint: "Create one at openrouter.ai/keys.",
		voiceLabel: "Voice",
		voicePlaceholder: "alloy",
		voiceHint: "alloy · echo · fable · onyx · nova · shimmer (OpenAI audio models).",
		modelLabel: "Model",
		modelPlaceholder: "openai/gpt-4o-audio-preview",
		modelHint: "Any audio-output model id from openrouter.ai/models?output_modalities=audio.",
		extras: ["format"],
	},
	openai: {
		id: "openai",
		label: "OpenAI (Speech)",
		description: "Native Text-to-Speech — same platform API key as Settings (Chat, STT, Images).",
		keyLabel: "OpenAI API key",
		keyHint: "Optional if you already saved a key under Settings → AI Chat & Agents.",
		voiceLabel: "Voice",
		voicePlaceholder: "alloy",
		voiceHint: "Voices: alloy, ash, ballad, coral, echo, fable, nova, onyx, sage, shimmer, verse — see platform.openai.com/docs/guides/text-to-speech.",
		modelLabel: "Model",
		modelPlaceholder: "tts-1",
		modelHint: "tts-1 (fast) or gpt-4o-mini-tts for newer models.",
	},
	suno: {
		id: "suno",
		label: "Suno (music)",
		description: "Song generator. 30–120s latency — use for jingles / agent songs.",
		keyLabel: "Suno API key",
		keyHint: "Defaults to the community wrapper at api.sunoapi.org.",
		modelLabel: "Model",
		modelPlaceholder: "V5_5",
		extras: ["baseUrl", "style", "instrumental"],
		footer: "Suno renders songs from a prompt — pass lyrics or a music description as the 'speak' text.",
	},
};

export function pickTTSConfig(initial?: TTSConfig): Promise<TTSConfig | null> {
	return new Promise((resolve) => {
		let resolved = false;
		const resolveOnce = (v: TTSConfig | null): void => {
			if (resolved) return;
			resolved = true;
			resolve(v);
		};

		const body = document.createElement("div");
		body.className = "tts-config";
		body.innerHTML = `
			<label class="tts-config__row">
				<span>Provider</span>
				<select data-field="provider">
					${Object.values(SCHEMAS).map((s) => `<option value="${s.id}">${s.label}</option>`).join("")}
				</select>
				<small class="tts-config__hint" data-field="providerDescription"></small>
			</label>
			<label class="tts-config__row" data-row="apiKey">
				<span data-label="apiKey">API key</span>
				<input type="password" data-field="apiKey" autocomplete="off" />
				<small class="tts-config__hint" data-field="keyHint"></small>
			</label>
			<label class="tts-config__row" data-row="voiceId">
				<span data-label="voiceId">Voice</span>
				<input type="text" data-field="voiceId" />
				<small class="tts-config__hint" data-field="voiceHint"></small>
			</label>
			<label class="tts-config__row" data-row="modelId">
				<span data-label="modelId">Model</span>
				<input type="text" data-field="modelId" />
				<small class="tts-config__hint" data-field="modelHint"></small>
			</label>
			<label class="tts-config__row" data-row="format" hidden>
				<span>Audio format</span>
				<select data-field="format">
					<option value="wav">wav (recommended)</option>
					<option value="mp3">mp3</option>
					<option value="flac">flac</option>
				</select>
			</label>
			<label class="tts-config__row" data-row="baseUrl" hidden>
				<span>API base URL</span>
				<input type="text" data-field="baseUrl" placeholder="https://api.sunoapi.org" />
			</label>
			<label class="tts-config__row" data-row="style" hidden>
				<span>Style hint</span>
				<input type="text" data-field="style" placeholder="lo-fi piano, melancholic" />
			</label>
			<label class="tts-config__row tts-config__row--inline" data-row="instrumental" hidden>
				<input type="checkbox" data-field="instrumental" />
				<span>Instrumental (no vocals)</span>
			</label>
			<div class="tts-config__footer" data-field="footer"></div>
			<div class="tts-config__actions">
				<button type="button" data-action="cancel">Cancel</button>
				<button type="button" data-action="save" class="primary">Save</button>
			</div>
		`;

		const $ = <T extends HTMLElement = HTMLElement>(selector: string): T | null =>
			body.querySelector<T>(selector);

		const providerSel = $<HTMLSelectElement>("[data-field=provider]")!;
		const apiKeyInput = $<HTMLInputElement>("[data-field=apiKey]")!;
		const voiceInput = $<HTMLInputElement>("[data-field=voiceId]")!;
		const modelInput = $<HTMLInputElement>("[data-field=modelId]")!;
		const formatSel = $<HTMLSelectElement>("[data-field=format]")!;
		const baseUrlInput = $<HTMLInputElement>("[data-field=baseUrl]")!;
		const styleInput = $<HTMLInputElement>("[data-field=style]")!;
		const instrumentalInput = $<HTMLInputElement>("[data-field=instrumental]")!;

		providerSel.value = initial?.provider ?? "elevenlabs";
		voiceInput.value = initial?.voiceId ?? "";
		modelInput.value = initial?.modelId ?? "";
		formatSel.value = initial?.format ?? "wav";
		baseUrlInput.value = initial?.baseUrl ?? "";
		styleInput.value = initial?.style ?? "";
		instrumentalInput.checked = initial?.instrumental ?? false;

		const applySchema = (): void => {
			const schema = SCHEMAS[providerSel.value as TTSProviderId];
			$("[data-field=providerDescription]")!.textContent = schema.description;
			$('[data-label="apiKey"]')!.textContent = schema.keyLabel;
			$("[data-field=keyHint]")!.textContent = schema.keyHint ?? "";
			apiKeyInput.placeholder = schema.keyHint?.slice(0, 50) ?? "";
			// Reuse stored key when switching providers — saves the user
			// re-typing every time they explore options.
			if (!initial || initial.provider !== schema.id) {
				apiKeyInput.value = getStoredApiKey(schema.id);
			} else {
				apiKeyInput.value = initial.apiKey ?? getStoredApiKey(schema.id);
			}

			toggleRow("voiceId", schema.voiceLabel != null);
			if (schema.voiceLabel) {
				$('[data-label="voiceId"]')!.textContent = schema.voiceLabel;
				voiceInput.placeholder = schema.voicePlaceholder ?? "";
				$("[data-field=voiceHint]")!.textContent = schema.voiceHint ?? "";
			}

			toggleRow("modelId", schema.modelLabel != null);
			if (schema.modelLabel) {
				$('[data-label="modelId"]')!.textContent = schema.modelLabel;
				modelInput.placeholder = schema.modelPlaceholder ?? "";
				$("[data-field=modelHint]")!.textContent = schema.modelHint ?? "";
			}

			const extras = new Set(schema.extras ?? []);
			toggleRow("format", extras.has("format"));
			toggleRow("baseUrl", extras.has("baseUrl"));
			toggleRow("style", extras.has("style"));
			toggleRow("instrumental", extras.has("instrumental"));
			$("[data-field=footer]")!.textContent = schema.footer ?? "";
		};

		const toggleRow = (row: string, show: boolean): void => {
			const el = body.querySelector<HTMLElement>(`[data-row="${row}"]`);
			if (el) el.hidden = !show;
		};

		applySchema();
		providerSel.addEventListener("change", applySchema);

		const modal = new Modal({
			title: "Voice settings",
			body,
			onClose: () => resolveOnce(null),
		});

		$<HTMLButtonElement>("[data-action=cancel]")!.addEventListener("click", () => modal.close());

		$<HTMLButtonElement>("[data-action=save]")!.addEventListener("click", async () => {
			const provider = providerSel.value as TTSProviderId;
			let apiKey = apiKeyInput.value.trim();
			if (!apiKey) apiKey = getStoredApiKey(provider);
			if (!apiKey) {
				apiKeyInput.focus();
				apiKeyInput.style.borderColor = "var(--danger)";
				return;
			}
			await setStoredApiKey(provider, apiKey);

			const config: TTSConfig = {
				provider,
				apiKey,
				voiceId: voiceInput.value.trim() || undefined,
				modelId: modelInput.value.trim() || undefined,
			};
			const extras = new Set(SCHEMAS[provider].extras ?? []);
			if (extras.has("format")) config.format = formatSel.value;
			if (extras.has("baseUrl") && baseUrlInput.value.trim()) {
				config.baseUrl = baseUrlInput.value.trim();
			}
			if (extras.has("style") && styleInput.value.trim()) config.style = styleInput.value.trim();
			if (extras.has("instrumental")) config.instrumental = instrumentalInput.checked;

			resolveOnce(config);
			modal.close();
		});
	});
}
