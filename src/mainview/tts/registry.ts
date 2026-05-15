// TTS routing per participant. One TTSProvider per participant, wired
// through the shared audio mixer so the agent's voice flows through the
// same path camera/mic audio uses (mixer channel + analyser for
// speaking-ring + broadcast capture).
//
// Components ask the registry for a provider rather than instantiating
// their own — the source factory, the Speak button, and the participant
// lifecycle cleanup all see the same instance.

import type { TTSProvider } from "./provider";
import { ElevenLabsTTSProvider } from "./elevenlabs-tts";
import { OpenRouterTTSProvider } from "./openrouter-tts";
import { OpenAiSpeechTTSProvider } from "./openai-speech-tts";
import { ElizaCloudTTSProvider } from "./elizacloud-tts";
import { OmniVoiceTTSProvider } from "./omnivoice-tts";
import { audioMixer } from "../streaming/audio-mixer";
import { studio } from "../state/studio-store";
import { ConfigError } from "../core/errors";
import type { ParticipantId } from "../core/ids";
import type { TTSConfig, TTSProviderId } from "../core/types";
import { getSecret, setSecretAndPersist } from "../auth/secrets-cache";

// API keys live in the per-user secrets cache (hydrated from local storage at
// login). Readers stay synchronous so existing TTS providers don't have
// to thread `await` through every call site; writes persist via RPC.

export function getStoredApiKey(provider: TTSProviderId): string {
	return getSecret(provider);
}

export async function setStoredApiKey(provider: TTSProviderId, key: string): Promise<void> {
	await setSecretAndPersist(provider, key);
}

const providers = new Map<string, TTSProvider>();

export function createTTSProvider(participantId: string, config: TTSConfig): TTSProvider {
	disposeTTSProvider(participantId);
	const provider = build(config);
	providers.set(participantId, provider);
	return provider;
}

export function getTTSProvider(participantId: string): TTSProvider | undefined {
	return providers.get(participantId);
}

export function disposeTTSProvider(participantId: string): void {
	const provider = providers.get(participantId);
	provider?.dispose();
	providers.delete(participantId);
}

// ── Voice routing (provider + mixer + state binding) ──────────────────
// Previously lived in tts/voice-route.ts — folded in because every call
// site in the renderer needed both halves to use a TTS provider safely.

export interface VoiceRoute {
	provider: TTSProvider;
	stream: MediaStream;
}

/** Build the provider + wire its audio into the mixer + persist the
 * config on the participant. Returns the route so the caller can keep
 * the stream reference if needed. */
export function initVoiceRoute(
	participantId: ParticipantId,
	config: TTSConfig,
	opts: { updateParticipant?: boolean } = {},
): VoiceRoute {
	audioMixer.removeInput(participantId);
	const provider = createTTSProvider(participantId, config);
	const stream = provider.getStream();
	audioMixer.addInput(participantId, stream);
	if (opts.updateParticipant !== false) {
		studio.updateParticipant(participantId, { tts: config, audioStream: stream });
	}
	return { provider, stream };
}

/** Return the currently-registered provider for this participant, or
 * build one lazily from the persisted TTS config. Returns null when the
 * participant has no TTS config. */
export function ensureVoiceRoute(participantId: ParticipantId): TTSProvider | null {
	const existing = getTTSProvider(participantId);
	if (existing) return existing;
	const participant = studio.state.participants[participantId];
	if (!participant?.tts) return null;
	return initVoiceRoute(participantId, participant.tts).provider;
}

export async function speakWithVoiceRoute(participantId: ParticipantId, text: string): Promise<void> {
	const provider = ensureVoiceRoute(participantId);
	if (!provider) {
		throw new ConfigError("No TTS provider configured", "Configure voice settings first.");
	}
	await provider.speak(text);
}

/** Tear down the provider AND its mixer input. Used by the participant
 * runtime cleanup; safe to call when nothing is registered. */
export function disposeVoiceRoute(participantId: ParticipantId): void {
	disposeTTSProvider(participantId);
	audioMixer.removeInput(participantId);
}

function build(config: TTSConfig): TTSProvider {
	const apiKey = config.apiKey || getStoredApiKey(config.provider);
	switch (config.provider) {
		case "elevenlabs":
			return new ElevenLabsTTSProvider(apiKey, config.voiceId, config.modelId);
		case "openrouter":
			return new OpenRouterTTSProvider({
				apiKey,
				model: config.modelId,
				voice: config.voiceId,
				format: config.format,
			});
		case "openai":
			return new OpenAiSpeechTTSProvider({
				apiKey,
				model: config.modelId,
				voice: config.voiceId,
			});
		case "elizacloud":
			return new ElizaCloudTTSProvider({
				apiKey,
				model: config.modelId,
				voice: config.voiceId,
			});
		case "omnivoice":
			return new OmniVoiceTTSProvider({
				voice: config.voiceId,
			});
	}
}
