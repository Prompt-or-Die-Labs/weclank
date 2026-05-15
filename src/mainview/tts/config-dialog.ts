// Modal that captures TTS config for an agent. Resolves with the chosen
// TTSConfig, or null if the user closed/canceled. The visible fields depend
// on the selected provider — the dialog hides irrelevant rows so the user
// only fills in what matters.

import { Modal } from "../components/overlays";
import { getStoredApiKey, setStoredApiKey } from "./registry";
import { PREMADE_VOICES, presetByVoiceId, DEFAULT_ELEVENLABS_VOICE_ID } from "./elevenlabs-voices";
import { mountOmnivoiceSetupCard } from "./omnivoice-setup-card";
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
	extras?: Array<"format">;
	footer?: string;
}

const SCHEMAS: Record<TTSProviderId, ProviderSchema> = {
	elevenlabs: {
		id: "elevenlabs",
		label: "ElevenLabs",
		description: "Realtime-friendly TTS with cloning. ~75ms first-byte. Same key powers studio music generation.",
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
	elizacloud: {
		id: "elizacloud",
		label: "Eliza Cloud",
		description: "OpenAI-compatible TTS via elizacloud.ai/api/v1 — includes their voice-cloning catalog.",
		keyLabel: "Eliza Cloud API key",
		keyHint: "Settings → AI Providers → Connect Eliza Cloud, or paste here.",
		voiceLabel: "Voice",
		voicePlaceholder: "alloy",
		voiceHint: "Voice id from your Eliza Cloud dashboard (OpenAI-compatible voice names also accepted).",
		modelLabel: "Model",
		modelPlaceholder: "tts-1",
		modelHint: "OpenAI-compatible TTS model id (e.g. tts-1).",
	},
	omnivoice: {
		id: "omnivoice",
		label: "OmniVoice (local)",
		description: "On-device TTS. No API key, no network. Finish the three-step setup below before saving.",
		keyLabel: "API key (unused)",
		keyHint: "OmniVoice runs locally; this field is ignored.",
		voiceLabel: "Voice / speaker hint",
		voicePlaceholder: "female young adult moderate happy",
		voiceHint: "Optional voice-design instruction passed to the model. Leave blank for default.",
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
			<label class="tts-config__row" data-row="voicePreset" hidden>
				<span>Voice</span>
				<div class="tts-config__voice-picker">
					<select data-field="voicePreset">
						${renderVoiceOptions()}
					</select>
					<button type="button" data-action="preview" title="Preview voice" aria-label="Preview voice">▶ Preview</button>
				</div>
				<audio data-field="previewAudio" preload="none" hidden></audio>
				<small class="tts-config__hint">Premade ElevenLabs voices. Pick "Custom voice ID…" at the bottom to paste a cloned or library voice id.</small>
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
			<div class="tts-config__omnivoice-setup" data-row="omnivoiceSetup" hidden></div>
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
		const voicePresetSel = $<HTMLSelectElement>("[data-field=voicePreset]")!;
		const previewAudio = $<HTMLAudioElement>("[data-field=previewAudio]")!;
		const previewBtn = $<HTMLButtonElement>("[data-action=preview]")!;

		providerSel.value = initial?.provider ?? "elevenlabs";
		voiceInput.value = initial?.voiceId ?? "";
		modelInput.value = initial?.modelId ?? "";
		formatSel.value = initial?.format ?? "wav";

		const initialVoiceId = (initial?.voiceId ?? "").trim();
		const initialPreset = initialVoiceId ? presetByVoiceId(initialVoiceId) : undefined;
		voicePresetSel.value = initialPreset?.voiceId ?? (initialVoiceId ? "__custom__" : DEFAULT_ELEVENLABS_VOICE_ID);

		// Sync raw field when picker changes; "__custom__" keeps the raw
		// input visible so power users can paste a cloned/library voice id.
		voicePresetSel.addEventListener("change", () => {
			if (voicePresetSel.value === "__custom__") {
				voiceInput.value = "";
				toggleRow("voiceId", true);
				voiceInput.focus();
			} else {
				voiceInput.value = voicePresetSel.value;
				toggleRow("voiceId", false);
			}
		});

		previewBtn.addEventListener("click", () => {
			const preset = presetByVoiceId(voicePresetSel.value);
			if (!preset?.previewUrl) return;
			previewAudio.src = preset.previewUrl;
			void previewAudio.play().catch(() => {/* silent if autoplay blocked */});
		});

		let omnivoiceCard: { dispose(): void; refresh(): Promise<void> } | null = null;
		const ensureOmnivoiceCard = (host: HTMLElement, show: boolean): void => {
			if (show && !omnivoiceCard) {
				host.innerHTML = "";
				omnivoiceCard = mountOmnivoiceSetupCard(host);
			} else if (!show && omnivoiceCard) {
				omnivoiceCard.dispose();
				omnivoiceCard = null;
				host.innerHTML = "";
			}
		};

		const applySchema = (): void => {
			const schema = SCHEMAS[providerSel.value as TTSProviderId];
			$("[data-field=providerDescription]")!.textContent = schema.description;
			$('[data-label="apiKey"]')!.textContent = schema.keyLabel;
			$("[data-field=keyHint]")!.textContent = schema.keyHint ?? "";
			apiKeyInput.placeholder = schema.keyHint?.slice(0, 50) ?? "";
			// OmniVoice runs locally — hide the API key row entirely.
			toggleRow("apiKey", schema.id !== "omnivoice");
			// OmniVoice gets an inline setup card right where the user will
			// need it. Mount on first switch-in; dispose when they pick a
			// different provider.
			const setupHost = $<HTMLElement>('[data-row="omnivoiceSetup"]');
			if (setupHost) {
				toggleRow("omnivoiceSetup", schema.id === "omnivoice");
				ensureOmnivoiceCard(setupHost, schema.id === "omnivoice");
			}
			// Reuse stored key when switching providers — saves the user
			// re-typing every time they explore options.
			if (!initial || initial.provider !== schema.id) {
				apiKeyInput.value = getStoredApiKey(schema.id);
			} else {
				apiKeyInput.value = initial.apiKey ?? getStoredApiKey(schema.id);
			}

			const useVoicePicker = schema.id === "elevenlabs";
			toggleRow("voicePreset", useVoicePicker);
			// Raw voice-id input: shown for non-ElevenLabs providers, OR
			// for ElevenLabs when the picker is on "Custom voice ID…".
			const showRawVoice = schema.voiceLabel != null && (!useVoicePicker || voicePresetSel.value === "__custom__");
			toggleRow("voiceId", showRawVoice);
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
			onClose: () => {
				omnivoiceCard?.dispose();
				omnivoiceCard = null;
				resolveOnce(null);
			},
		});

		$<HTMLButtonElement>("[data-action=cancel]")!.addEventListener("click", () => modal.close());

		$<HTMLButtonElement>("[data-action=save]")!.addEventListener("click", async () => {
			const provider = providerSel.value as TTSProviderId;
			let apiKey = apiKeyInput.value.trim();
			if (!apiKey) apiKey = getStoredApiKey(provider);
			// OmniVoice runs locally; no key required.
			const keyOptional = provider === "omnivoice";
			if (!apiKey && !keyOptional) {
				apiKeyInput.focus();
				apiKeyInput.style.borderColor = "var(--danger)";
				return;
			}
			if (apiKey) await setStoredApiKey(provider, apiKey);

			// When the ElevenLabs picker is showing and not on "custom",
			// the picked voiceId beats whatever's in the raw input.
			let voiceId = voiceInput.value.trim();
			if (provider === "elevenlabs" && voicePresetSel.value && voicePresetSel.value !== "__custom__") {
				voiceId = voicePresetSel.value;
			}

			const config: TTSConfig = {
				provider,
				apiKey,
				voiceId: voiceId || undefined,
				modelId: modelInput.value.trim() || undefined,
			};
			const extras = new Set(SCHEMAS[provider].extras ?? []);
			if (extras.has("format")) config.format = formatSel.value;

			resolveOnce(config);
			modal.close();
		});
	});
}

/** Render the ElevenLabs voice picker, grouped by gender. Appends a
 * "Custom voice ID…" option so power users can paste their own cloned or
 * library voice id without leaving the picker model. */
function renderVoiceOptions(): string {
	const groups: Array<{ label: string; gender: "female" | "male" | "character" }> = [
		{ label: "Female", gender: "female" },
		{ label: "Male", gender: "male" },
		{ label: "Character", gender: "character" },
	];
	const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
	const parts = groups.map((g) => {
		const opts = PREMADE_VOICES.filter((v) => v.gender === g.gender)
			.map((v) => `<option value="${esc(v.voiceId)}">${esc(v.name)} — ${esc(v.hint)}</option>`)
			.join("");
		return `<optgroup label="${esc(g.label)}">${opts}</optgroup>`;
	});
	parts.push('<option value="__custom__">Custom voice ID…</option>');
	return parts.join("");
}
