// One TTSProvider per participant + per-provider key storage. Components
// ask the registry for a provider rather than instantiating their own — the
// source factory, the participant tile's Speak button, and the studio
// store's cleanup all see the same instance.

import type { TTSProvider } from "./provider";
import { ElevenLabsTTSProvider } from "./elevenlabs-tts";
import { OpenRouterTTSProvider } from "./openrouter-tts";
import { SunoTTSProvider } from "./suno-tts";
import type { TTSConfig, TTSProviderId } from "../core/types";
import { getSecret, setSecretAndPersist } from "../auth/secrets-cache";

// API keys live in the per-user secrets cache (hydrated from SQLite at
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
		case "suno":
			return new SunoTTSProvider({
				apiKey,
				baseUrl: config.baseUrl,
				model: config.modelId,
				style: config.style,
				instrumental: config.instrumental,
			});
	}
}
